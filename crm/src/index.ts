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
import { readSession, signSession, verifyTelegramLogin } from './auth';
import { loginPage } from './views/login';
import type { Viewer } from './views/layout';
import { listLeads } from './db';
import { leadsPage } from './views/leads';

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

export default app;
