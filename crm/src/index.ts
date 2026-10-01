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
import { applyChange, createLead, getLead, historyByPhone, listDay, listLeads } from './db';
import { leadsPage } from './views/leads';
import { leadPage } from './views/lead';
import { clientPage } from './views/client';
import { todayPage } from './views/today';
import { newLeadPage } from './views/new';
import { layout } from './views/layout';
import { html } from 'hono/html';
import { syncCard } from './sync';
import { clean, type Status } from '../../shared/card';
import { fromLocalInput, kyivDayBounds, toKop, toPhone } from './format';

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

/**
 * Межі київської доби для дати з поля `<input type="date">`.
 *
 * Сміття й порожнє значення дають null, тобто «межі не задані» — так
 * фільтр і поводився досі. Без перевірки формату `new Date('абракадабра')`
 * привів би kyivDayBounds до RangeError, тобто до 500 замість порожнього
 * списку.
 *
 * Полудень UTC — безпечна точка всередині потрібної доби: київський час
 * випереджає UTC на 2–3 години, тож календарна дата та сама.
 */
function kyivDay(date: string): { from: string; to: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const noon = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(noon.getTime())) return undefined;
  return kyivDayBounds(noon);
}

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get('q') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';

  /* Поле date дає «2026-09-30», а в базі час у UTC. Межі рахуємо за
     київською добою, не за UTC: заявка о 01:00 за Києвом — це ще
     попередній день за UTC, і при межах за UTC вона потрапила б у
     «чуже» число. Власник, відфільтрувавши «сьогодні», побачив би інший
     набір, ніж у «Сьогодні», який уже рахує по-київськи.

     `to` — кінець доби **не включно** (початок наступної): дата кінця
     київської доби не має фіксованої тривалості, бо двічі на рік доба
     триває 23 або 25 годин. */
  const rows = await listLeads(c.env.DB, {
    q: q || undefined,
    status: status || undefined,
    from: kyivDay(from)?.from,
    to: kyivDay(to)?.to,
  });

  return c.html(leadsPage(rows, { q, status, from, to }, c.get('viewer')));
});

/** Номер заявки з адреси. Усе, що не є цілим додатним числом, — не наша заявка */
function leadId(raw: string): number | null {
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/**
 * Сторінка «дію не виконано, і ось чому».
 *
 * Форми тут — звичайний HTML без JS, тож прочитати причину оператор може
 * лише на окремій сторінці. Мовчазний редірект назад на заявку виглядає
 * як «нічого не сталося», і людина тисне ще раз.
 */
const problemPage = (viewer: Viewer, id: number, title: string, hint: string) =>
  layout(
    title,
    html`<h1>${title}</h1>
      <p>${hint}</p>
      <p><a href="/lead/${id}">← Назад до заявки</a></p>`,
    viewer
  );

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
  const viewer = c.get('viewer');
  const at = fromLocalInput(String(form.get('appointment_at') ?? ''));

  /* Порожній або нерозібраний час — не запис. Тут саме сторінка з
     поясненням, а не редірект: /close на непрочитану суму поводиться так
     само, і два поля однієї картки не мусять відповідати по-різному.
     Стерти наявний запис порожнім полем теж не можна — для цього є
     окрема кнопка «Скасувати запис». */
  if (!at) {
    return c.html(
      problemPage(
        viewer,
        id,
        'Час запису не розібрано',
        'Оберіть дату й час у полі «Записати на». Щоб зняти наявний запис, ' +
          'скористайтеся кнопкою «Скасувати запис».'
      ),
      400
    );
  }

  // Запис означає, що заявку взяли в роботу — окремого стану немає
  await applyChange(c.env.DB, id, {
    appointment_at: at,
    ...(lead.status === 'new'
      ? { status: 'in_work' as const, actor_id: viewer.tg_id, actor_name: viewer.name }
      : {}),
  });

  c.executionCtx.waitUntil(syncCard(c.env, id));
  return c.redirect(`/lead/${id}`);
});

/**
 * Знятий запис: клієнт скасував, а заявка лишається в роботі.
 *
 * Без цього маршруту заявку неможливо прибрати зі «Сьогодні», не
 * зіпсувавши дані: лишались або вигадана дата, або передчасний фінал.
 * Стану не чіпаємо — скасований запис не означає, що робота скінчилась.
 *
 * Фінальні стани теж пропускаємо: прибрати застарілий запис із
 * закритої заявки нічого не псує, а «Сьогодні» і так показує лише живі.
 */
app.post('/lead/:id/unappoint', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!id || !lead) return c.notFound();

  // Знімати нічого — і картку перемальовувати нема за чим
  if (!lead.appointment_at) return c.redirect(`/lead/${id}`);

  await applyChange(c.env.DB, id, { appointment_at: null });

  c.executionCtx.waitUntil(syncCard(c.env, id));
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
      problemPage(
        viewer,
        id,
        'Сума не вказана',
        'Введіть суму числом, наприклад 1200 або 1200,50.'
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

  c.executionCtx.waitUntil(syncCard(c.env, id));
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

  /* Власна причина, якщо її вписали, бере гору над списком: інакше
     вписаний вручну текст губився б мовчки, щойно в списку щось обрано.
     Обидва можуть бути порожні — відмова без причини дозволена, як у
     боті, і перший пункт списку порожній саме для цього. */
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

  c.executionCtx.waitUntil(syncCard(c.env, id));
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

  c.executionCtx.waitUntil(syncCard(c.env, id));
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

/* Заявка зі слів клієнта, який подзвонив.
   Без неї CRM бачила б лише ту частину потоку, що прийшла з сайту, —
   а на цих даних стоять і історія клієнта, і майбутні звіти. */
app.get('/new', (c) => c.html(newLeadPage(c.get('viewer'))));

app.post('/new', async (c) => {
  const form = await c.req.formData();
  const raw = {
    name: String(form.get('name') ?? ''),
    phone: String(form.get('phone') ?? ''),
    car: String(form.get('car') ?? ''),
    age: String(form.get('age') ?? ''),
    appointment_at: String(form.get('appointment_at') ?? ''),
  };

  const name = clean(raw.name, 120);
  const phone = toPhone(raw.phone);

  /* Повертаємо сторінку з набраним, а не порожню: оператор щойно
     говорив із клієнтом і не має передруковувати все через одну цифру */
  if (!name) return c.html(newLeadPage(c.get('viewer'), 'Вкажіть імʼя клієнта.', raw), 400);
  if (!phone) {
    return c.html(
      newLeadPage(c.get('viewer'), 'Телефон не схожий на український мобільний.', raw),
      400
    );
  }

  const viewer = c.get('viewer');
  const id = await createLead(c.env.DB, {
    name,
    phone,
    age: clean(raw.age, 40) || null,
    car: clean(raw.car, 120) || null,
    appointment_at: fromLocalInput(raw.appointment_at),
    actor_id: viewer.tg_id,
    actor_name: viewer.name,
  });

  if (!id) {
    return c.html(newLeadPage(c.get('viewer'), 'Не вдалося зберегти заявку.', raw), 500);
  }

  /* Картка йде в групу так само, як для вебзаявки: майстри мусять
     бачити всю вхідну роботу, а не половину. drawCard сам надішле нове
     повідомлення, бо chat_id у свіжого рядка порожній, і запамʼятає
     його — далі заявка живе звичайним життям. */
  c.executionCtx.waitUntil(syncCard(c.env, id));

  return c.redirect(`/lead/${id}`);
});

app.get('/today', async (c) => {
  /* Доба — київська, а в базі час у UTC. Запис на 00:30 за Києвом — це
     ще вчорашній день за UTC, і без перерахунку він зник би зі списку. */
  const { from, to } = kyivDayBounds();
  const rows = await listDay(c.env.DB, from, to);
  return c.html(todayPage(rows, c.get('viewer')));
});

export default app;
