/**
 * POST /api/lead — приймає заявку і кладе її власнику в Telegram.
 *
 * Розміщення: functions/api/lead.ts (Cloudflare Pages Functions)
 * Той самий домен, отже без CORS і без окремого воркера.
 *
 * Секрети (Pages → Settings → Environment variables, тип Secret):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 * Прив'язка (Settings → Functions → KV bindings):
 *   RATE  →  KV namespace для обмеження частоти
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  RATE?: KVNamespace;
}

const RATE_LIMIT = 5;           // заявок
const RATE_WINDOW = 3600;       // за годину, на IP
const MIN_ELAPSED_MS = 2500;    // швидше — майже напевно бот
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Завжди 200 для клієнта: не даємо ботам зворотного зв'язку про причину відмови */
const ok = () => new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const fail = (status: number) => new Response(JSON.stringify({ ok: false }), {
  status,
  headers: { 'content-type': 'application/json' },
});

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // ── 1. Обмеження частоти ────────────────────────────────
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.RATE) {
    const key = `lead:${ip}`;
    const count = Number((await env.RATE.get(key)) ?? 0);
    if (count >= RATE_LIMIT) return fail(429);
    await env.RATE.put(key, String(count + 1), { expirationTtl: RATE_WINDOW });
  }

  // ── 2. Розбір ───────────────────────────────────────────
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400);
  }

  const phone = String(form.get('phone') ?? '').trim();
  const honeypot = String(form.get('company') ?? '').trim();
  const elapsed = Number(form.get('elapsed') ?? 0);
  const page = String(form.get('page') ?? '/');

  // ── 3. Антиспам ─────────────────────────────────────────
  // Обидві перевірки тихі: бот отримує 200 і вважає, що спрацював.
  // Гучна помилка тільки навчила б його обходити фільтр.
  if (honeypot) return ok();
  if (elapsed > 0 && elapsed < MIN_ELAPSED_MS) return ok();

  // ── 4. Валідація ────────────────────────────────────────
  if (!/^\+380\d{9}$/.test(phone)) return fail(400);

  const photo = form.get('photo');
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (hasPhoto && photo.size > MAX_PHOTO_BYTES) return fail(413);

  // ── 5. Відправка в Telegram ─────────────────────────────
  const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
  const caption =
    `🔧 Нова заявка\n` +
    `Телефон: ${phone}\n` +
    `Сторінка: ${page}\n` +
    `Час: ${time}` +
    (hasPhoto ? '' : '\n\nБез фото');

  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

  try {
    let res: Response;

    if (hasPhoto) {
      const tg = new FormData();
      tg.set('chat_id', env.TELEGRAM_CHAT_ID);
      tg.set('caption', caption);
      tg.set('photo', photo, 'skol.jpg');
      res = await fetch(`${api}/sendPhoto`, { method: 'POST', body: tg });

      // Telegram інколи відхиляє зображення (формат, розмір).
      // Втратити фото прикро, втратити заявку — неприпустимо.
      if (!res.ok) {
        res = await fetch(`${api}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text: `${caption}\n\n⚠️ Фото не передалося — передзвоніть і попросіть надіслати`,
          }),
        });
      }
    } else {
      res = await fetch(`${api}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: caption }),
      });
    }

    if (!res.ok) return fail(502);
  } catch {
    return fail(502);
  }

  return ok();
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : fail(405);
