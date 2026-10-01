/**
 * CRM: заявки і клієнти.
 *
 * Окремий Worker, а не частина сайту: сайт — статика з бюджетом
 * швидкості й навмисним предохранителем, який валить продакшн-збірку на
 * тимчасових даних, а CRM — застосунок, якому цей предохранитель не має
 * заважати розгортатися. База в них спільна.
 */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './env';
import { missingSecret, readSession, signSession, verifyTelegramLogin } from './auth';
import { loginPage } from './views/login';
import type { Viewer } from './views/layout';
import { applyChange, getLead, historyByPhone, listDay, listLeads } from './db';
import { leadsPage } from './views/leads';
import { leadPage } from './views/lead';
import { clientPage } from './views/client';
import { todayPage } from './views/today';
import { layout } from './views/layout';
import { html } from 'hono/html';
import { syncCard } from './sync';
import { clean, type Status } from '../../shared/card';
import { fromLocalInput, kyivDayBounds, toKop } from './format';

const app = new Hono<{ Bindings: Env; Variables: { viewer: Viewer } }>();

const COOKIE = 'crm_session';

/** Імʼя бота для віджета. Значення видиме в HTML — це не секрет */
const BOT_NAME = 'avtosklouabot';

/* Сторінки CRM показують імена й телефони клієнтів, тож їх не можна
   ні осаджувати в проміжних кешах, ні вбудовувати в чужу рамку
   (клікджекінг). Середина стоїть першою, щоб покрити й сторінку входу,
   і відповіді з редіректами та помилками. /health — технічна
   перевірка без даних, її не чіпаємо. */
app.use('*', async (c, next) => {
  if (new URL(c.req.url).pathname !== '/health') {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', "frame-ancestors 'none'");
  }
  return next();
});

// Перевірка живості: не вимагає ні бази, ні входу
app.get('/health', (c) => c.text('ok'));

/* Без секретів CRM не обслуговує нічого.
 *
 * Порожній TELEGRAM_BOT_TOKEN не ламав вхід, а відкривав його: ключем
 * HMAC ставала SHA-256 від порожнього входу, публічно відома константа
 * (докладніше — у missingSecret()). Саме в такому стані стоїть щойно
 * розгорнутий Worker, поки не виконано `wrangler secret put`.
 *
 * Відмова видима, а не мовчазний 500: власник, який відкриє CRM раніше,
 * ніж поставить секрети, мусить прочитати причину, а не гадати. 503 —
 * «ще не налаштовано», не «зламано». /health лишається доступним: це
 * технічна перевірка живості без даних, і вона зареєстрована вище.
 */
app.use('*', async (c, next) => {
  if (new URL(c.req.url).pathname === '/health') return next();

  const missing = missingSecret(c.env);
  if (missing) {
    // У журнал іде назва змінної, не значення
    console.error(`CRM не налаштовано: ${missing} порожній або надто короткий`);
    return c.html(
      loginPage(
        BOT_NAME,
        `CRM не налаштовано: не задано ${missing}. ` +
          'Поставте секрети Worker (wrangler secret put) — до того вхід неможливий.'
      ),
      503
    );
  }

  return next();
});

app.get('/login', (c) => c.html(loginPage(BOT_NAME)));

app.get('/auth', async (c) => {
  const params = Object.fromEntries(new URL(c.req.url).searchParams.entries());

  if (!(await verifyTelegramLogin(params, c.env.TELEGRAM_BOT_TOKEN))) {
    return c.html(loginPage(BOT_NAME, 'Підпис Telegram не підтвердився.'), 403);
  }

  const row = await c.env.DB.prepare('SELECT tg_id, active FROM users WHERE tg_id = ?')
    .bind(String(params.id))
    .first<{ tg_id: string; active: number }>();

  if (!row || row.active !== 1) {
    return c.html(loginPage(BOT_NAME, 'Цей обліковий запис не має доступу.'), 403);
  }

  setCookie(c, COOKIE, await signSession(row.tg_id, c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  return c.redirect('/');
});

app.post('/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' });
  return c.redirect('/login');
});

/* Усе, крім входу й перевірки живості, вимагає сесії. active
   перевіряється щоразу, тож знятий доступ діє негайно, не чекаючи
   строку куки. */
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/login' || path === '/auth' || path === '/health') return next();

  const tgId = await readSession(getCookie(c, COOKIE), c.env.SESSION_SECRET);
  if (!tgId) return c.redirect('/login');

  const viewer = await c.env.DB.prepare(
    'SELECT tg_id, name, role FROM users WHERE tg_id = ? AND active = 1'
  )
    .bind(tgId)
    .first<Viewer>();

  if (!viewer) {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.redirect('/login');
  }

  c.set('viewer', viewer);
  return next();
});

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get('q') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';

  /* Поле date дає «2026-09-30», а в базі час у UTC з часом доби. «До»
     включно, тож беремо кінець дня, інакше заявки самого цього дня
     випали б із вибірки. */
  const rows = await listLeads(c.env.DB, {
    q: q || undefined,
    status: status || undefined,
    from: from ? `${from}T00:00:00.000Z` : undefined,
    to: to ? `${to}T23:59:59.999Z` : undefined,
  });

  return c.html(leadsPage(rows, { q, status, from, to }, c.get('viewer')));
});

/** Номер заявки з адреси. Усе, що не є цілим додатним числом, — не наша заявка */
function leadId(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

app.get('/lead/:id', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!lead) return c.notFound();
  const history = await historyByPhone(c.env.DB, lead.phone);
  return c.html(leadPage(lead, history, c.get('viewer')));
});

app.post('/lead/:id/appoint', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!id || !lead) return c.notFound();

  // Запис має сенс лише для живої заявки; у фіналі спершу «Повернути»
  if (lead.status === 'done' || lead.status === 'declined') return c.redirect(`/lead/${id}`);

  const form = await c.req.formData();
  const at = fromLocalInput(String(form.get('appointment_at') ?? ''));
  // Порожній або нерозібраний час — не запис: не беремо заявку в роботу
  // і не стираємо попередній запис
  if (!at) return c.redirect(`/lead/${id}`);

  const viewer = c.get('viewer');

  // Запис означає, що заявку взяли в роботу — окремого стану немає
  await applyChange(c.env.DB, id, {
    appointment_at: at,
    ...(lead.status === 'new'
      ? { status: 'in_work' as const, actor_id: viewer.tg_id, actor_name: viewer.name }
      : {}),
  });

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});

app.post('/lead/:id/close', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!id || !lead) return c.notFound();

  // З відмови в «виконано» напряму не можна — спершу «Повернути», як у боті
  if (lead.status === 'declined') return c.redirect(`/lead/${id}`);

  const form = await c.req.formData();
  const viewer = c.get('viewer');

  // Закриття без суми — це й є те, що потім не зійдеться у звіті
  const amount = toKop(String(form.get('amount') ?? ''));
  if (amount === null) {
    return c.html(
      layout(
        'Сума не вказана',
        html`<h1>Сума не вказана</h1>
          <p>Введіть суму числом, наприклад 1200 або 1200,50.</p>
          <p><a href="/lead/${id}">← Назад до заявки</a></p>`,
        viewer
      ),
      400
    );
  }

  const workNote = clean(form.get('work_note'), 400) || null;

  if (lead.status === 'done') {
    /* Уточнення вже виконаної заявки — найчастіше тієї, яку закрили
       кнопкою в боті, де суми немає. Переходу тут нема, тож патч без
       `status`: сторож `status <> ?` у applyChange стоїть на переході, і
       з ним ці поля мовчки не записались би. Виконавця не міняємо: хто
       взяв, той і взяв. */
    await applyChange(c.env.DB, id, {
      closed_at: lead.closed_at ?? new Date().toISOString(),
      amount,
      work_note: workNote,
    });
  } else {
    await applyChange(c.env.DB, id, {
      status: 'done',
      closed_at: new Date().toISOString(),
      amount,
      work_note: workNote,
      actor_id: viewer.tg_id,
      actor_name: viewer.name,
    });
  }

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});

app.post('/lead/:id/decline', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!id || !lead) return c.notFound();

  // З «виконано» в відмову напряму не можна — спершу «Повернути», як у боті
  if (lead.status === 'done') return c.redirect(`/lead/${id}`);

  const form = await c.req.formData();
  const viewer = c.get('viewer');

  /* Власна причина, якщо її вписали, бере гору над списком: у списку
     завжди стоїть перший пункт, і вписаний вручну текст мовчки
     губився б, якщо не змінити вибір. */
  const other = clean(form.get('other'), 200);
  const picked = clean(form.get('reason'), 200);
  const reason = other || picked || null;

  if (lead.status === 'declined') {
    /* Причина для заявки, відмовленої без неї (наприклад, з бота, де її
       можна дописати будь-коли). Патч без `status`, інакше сторож
       `status <> ?` відкинув би й причину. Порожнє значення нічого не
       стирає. */
    if (reason) await applyChange(c.env.DB, id, { decline_reason: reason });
  } else {
    await applyChange(c.env.DB, id, {
      status: 'declined',
      actor_id: viewer.tg_id,
      actor_name: viewer.name,
      decline_reason: reason,
    });
  }

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});

app.post('/lead/:id/undo', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!id || !lead) return c.notFound();

  /* Як у боті, повернення є лише з фінальних станів. Без цього подвійне
     натискання зробило б зі щойно повернутої заявки ту саму, що була
     до повернення: prev_status у неї якраз вказує назад. */
  if (lead.status !== 'done' && lead.status !== 'declined') return c.redirect(`/lead/${id}`);

  /* prev_status не приймаємо на віру. Бот тримає інваріант «попередній
     стан ніколи не фінальний», але рядок, записаний інакше, замкнув би
     заявку між двома фіналами. Тому фінальне значення — це «нова». */
  const p = lead.prev_status;
  const target: Status = p && p !== 'done' && p !== 'declined' ? p : 'new';

  const viewer = c.get('viewer');
  await applyChange(c.env.DB, id, {
    status: target,
    actor_id: viewer.tg_id,
    actor_name: viewer.name,
  });

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});

app.get('/client/:phone', async (c) => {
  /* Hono уже розкодував параметр адреси. Повторний decodeURIComponent
     зіпсував би номер із «%» і падав би на некоректній послідовності. */
  const phone = c.req.param('phone');
  const rows = await historyByPhone(c.env.DB, phone);
  if (rows.length === 0) return c.notFound();
  return c.html(clientPage(phone, rows, c.get('viewer')));
});

app.get('/today', async (c) => {
  /* Доба — київська, а в базі час у UTC. Запис на 00:30 за Києвом — це
     ще вчорашній день за UTC, і без перерахунку він зник би зі списку. */
  const { from, to } = kyivDayBounds();
  const rows = await listDay(c.env.DB, from, to);
  return c.html(todayPage(rows, c.get('viewer')));
});

export default app;
