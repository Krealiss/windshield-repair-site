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
const MAX_FIELD_CHARS = 80;

/** Три відповіді кроку «як давно». Будь-що інше ігнорується:
    поле приходить від радіокнопок, тож стороннє значення означає
    або підробку, або розсинхрон із формою. */
const AGES = ['До 2 днів', 'Тиждень', 'Більше тижня'];

/**
 * Хто питає. Браузер, який надсилає форму сам (скрипт не приїхав),
 * просить text/html — йому потрібна сторінка, а не JSON. Скрипт
 * просить application/json явно.
 */
const wantsHtml = (request: Request) =>
  (request.headers.get('accept') ?? '').includes('text/html');

const FAIL_PAGE = `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><title>Заявку не надіслано</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>Заявку не надіслано</h1>
<p>Спробуйте ще раз або зателефонуйте — так швидше.</p>
<p><a href="/">← На головну</a></p>
</body></html>`;

/** Завжди «успіх» для клієнта: не даємо ботам зворотного зв'язку про причину відмови */
const ok = (html: boolean) =>
  html
    ? new Response(null, { status: 303, headers: { location: '/thanks/' } })
    : new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

const fail = (status: number, html: boolean) =>
  html
    ? new Response(FAIL_PAGE, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    : new Response(JSON.stringify({ ok: false }), {
        status,
        headers: { 'content-type': 'application/json' },
      });

/**
 * Приводить текст із форми до вигляду, придатного для повідомлення:
 * переноси рядків і керівні символи стають пробілами, зайве
 * обрізається. Причина не косметична — підпис до фотографії в
 * Telegram обмежений 1024 символами, і заявка, яка через довге поле
 * не надіслалась, гірша за обрізане ім'я.
 */
const clean = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? '')
    .replace(/[ -]+/g, ' ')
    .trim()
    .slice(0, max);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const html = wantsHtml(request);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';

  // ── 1. Розбір ───────────────────────────────────────────
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, html);
  }

  // Пробіли й дужки прибираються тут, а не тільки в скрипті: без JS
  // людина вводить номер так, як звикла («+380 67 123 45 67»), і
  // строга перевірка нижче відкинула б цілком правильний номер
  const phone = clean(form.get('phone'), 32).replace(/[^\d+]/g, '');
  const name = clean(form.get('name'), MAX_FIELD_CHARS);
  const car = clean(form.get('car'), MAX_FIELD_CHARS);
  const ageRaw = clean(form.get('age'), MAX_FIELD_CHARS);
  const age = AGES.includes(ageRaw) ? ageRaw : '';
  const honeypot = clean(form.get('company'), MAX_FIELD_CHARS);
  const elapsed = Number(form.get('elapsed') ?? 0);
  const page = clean(form.get('page'), 120) || '/';

  // ── 2. Антиспам ─────────────────────────────────────────
  // Обидві перевірки тихі: бот отримує «успіх» і вважає, що спрацював.
  // Гучна помилка тільки навчила б його обходити фільтр.
  if (honeypot) return ok(html);
  if (elapsed > 0 && elapsed < MIN_ELAPSED_MS) return ok(html);

  // ── 3. Валідація ────────────────────────────────────────
  // Обов'язкові рівно три речі: ім'я, телефон і згода. Давність,
  // марка й фото пропускаються навмисно — див. специфікацію.
  if (!/^\+380\d{9}$/.test(phone)) return fail(400, html);
  if (!name) return fail(400, html);

  const photo = form.get('photo');
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (hasPhoto && photo.size > MAX_PHOTO_BYTES) return fail(413, html);

  // ── 4. Обмеження частоти ────────────────────────────────
  //
  // Лічильник рахує тільки те, що доходить сюди — заявки, які справді
  // підуть у Telegram. Раніше він стояв першим і збільшувався на
  // будь-якому POST, зокрема на порожньому чи мусорному. Наслідок був
  // неочевидний і бив по живих людях: в українських мобільних мережах
  // сотні абонентів сидять за одним IP, і бот міг вичерпати їхню спільну
  // квоту, жодного разу не надіславши валідної заявки.
  //
  // get + put не атомарні: два одночасні запити можуть прочитати те саме
  // число. Найгірше, що з цього виходить — кілька зайвих заявок понад
  // ліміт. Ціна атомарності тут (Durable Object) вища за проблему.
  if (env.RATE) {
    const key = `lead:${ip}`;
    const count = Number((await env.RATE.get(key)) ?? 0);
    if (count >= RATE_LIMIT) return fail(429, html);
    await env.RATE.put(key, String(count + 1), { expirationTtl: RATE_WINDOW });
  }

  // ── 5. Відправка в Telegram ─────────────────────────────
  //
  // Порожні поля не згадуються взагалі: інакше половина заявок
  // перетворюється на список прочерків, у якому не видно заповненого.
  //
  // parse_mode не задається навмисно. Повідомлення містить текст, який
  // вписала людина, і з розміткою ім'я на кшталт «<b» ламало б усе
  // повідомлення або ховало частину заявки.
  const time = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });

  const lines = [`🔧 Нова заявка`, `Ім'я: ${name}`, `Телефон: ${phone}`];
  if (age) lines.push(`Давність: ${age}`);
  if (car) lines.push(`Авто: ${car}`);
  lines.push(`Сторінка: ${page}`, `Час: ${time}`);
  if (!hasPhoto) lines.push('', 'Без фото');
  const caption = lines.join('\n');

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

    if (!res.ok) return fail(502, html);
  } catch {
    return fail(502, html);
  }

  return ok(html);
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : fail(405, wantsHtml(request));
