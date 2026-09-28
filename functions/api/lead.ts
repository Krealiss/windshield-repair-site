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

import { cardText, clean, keyboard, kyivDate, type LeadRow, type Status } from '../_lib/card';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  RATE?: KVNamespace;
  /* Знак питання навмисно: привʼязку можна забути, і це не має
     коштувати заявки — див. відправку нижче */
  DB?: D1Database;
}

const RATE_LIMIT = 5;           // заявок на IP
const RATE_WINDOW = 3600;       // секунд ковзного вікна — див. коментар нижче, п. 4
const MIN_ELAPSED_MS = 2500;    // швидше — майже напевно бот
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/* Стільки знімків іде в альбом. Те саме число стоїть у формі
   (MAX_PHOTOS у LeadForm.astro) — вони мусять збігатися, інакше
   людина надішле більше, ніж оператор побачить. */
const MAX_PHOTOS = 3;
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

  // Згода — вимога закону, і перевіряти її лише в браузері замало:
  // прямий POST повз форму проходив би без неї, а заявка без згоди
  // не має права опинитися в CRM
  if (!form.get('consent')) return fail(400, html);

  // Завелике фото відкидаємо, а не всю заявку: без JS стискання не
  // відбувається взагалі (знімок із сучасного телефона — 4–8 МБ), і
  // людина з вимкненими скриптами прикріпила б файл і втратила заявку
  // разом із ним. Той самий принцип, що й нижче для фото, яке не
  // прийняв сам Telegram, — заявка без фото важливіша за фото без заявки.
  /*
    Знімків може бути кілька: форма просить зняти скол із різних
    ракурсів, тож поле одне, а файлів під ним — до трьох.

    Завеликі відсіюються поштучно, а не валять усю заявку: втратити
    один знімок прикро, втратити заявку — неприпустимо. Скільки саме
    відсіялось, оператор побачить у тексті.
  */
  const sent = form.getAll('photo').filter((p): p is File => p instanceof File && p.size > 0);
  const photos = sent.filter((p) => p.size <= MAX_PHOTO_BYTES).slice(0, MAX_PHOTOS);
  const oversized = sent.length - photos.length;
  const hasPhoto = photos.length > 0;

  // ── 4. Обмеження частоти ────────────────────────────────
  //
  // Лічильник рахує тільки те, що доходить сюди — заявки, які справді
  // підуть у Telegram. Раніше він стояв першим і збільшувався на
  // будь-якому POST, зокрема на порожньому чи мусорному. Наслідок був
  // неочевидний і бив по живих людях: в українських мобільних мережах
  // сотні абонентів сидять за одним IP, і бот міг вичерпати їхню спільну
  // квоту, жодного разу не надіславши валідної заявки.
  //
  // Вікно не годинне від першої заявки, а ковзне: expirationTtl
  // виставляється заново при кожній прийнятій заявці, тож ключ живе
  // годину від ОСТАННЬОЇ прийнятої заявки, а не від першої. П'ять
  // заявок з одного IP, розтягнуті хоч на півдня (з паузами менше
  // години між сусідніми), усе одно замкнуть шосту — лічильник не
  // встигає обнулитися, поки заявки продовжують приходити.
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

  // ── 5. Запис у базу ─────────────────────────────────────
  //
  // Рядок створюється ДО відправки: його id — це номер заявки в
  // картці, і взяти його більше нізвідки.
  //
  // Якщо бази немає або запит до неї впав — заявка все одно піде.
  // Втратити заявку через відсутню привʼязку неприпустимо; оператор
  // побачить попередження просто в картці.
  const createdAt = new Date().toISOString();

  let lead: LeadRow = {
    id: 0,
    created_at: createdAt,
    name,
    phone,
    age: age || null,
    car: car || null,
    photos: photos.length,
    status: 'new' as Status,
    prev_status: null,
    actor_name: null,
  };

  const notes: string[] = [];

  if (env.DB) {
    try {
      // Попереднє звернення шукаємо до вставки, інакше знайдемо
      // самих себе
      const before = await env.DB.prepare(
        'SELECT created_at FROM leads WHERE phone = ? ORDER BY created_at DESC LIMIT 1'
      )
        .bind(phone)
        .first<{ created_at: string }>();

      if (before) {
        notes.push(`⚠️ Цей номер уже звертався: ${kyivDate(before.created_at)}`);
      }

      // last_row_id, а не RETURNING: перше є в D1 завжди, друге
      // залежить від версії рушія, і мовчазна відмова тут коштувала б
      // номера заявки
      const inserted = await env.DB.prepare(
        `INSERT INTO leads (created_at, name, phone, age, car, photos, status)
         VALUES (?, ?, ?, ?, ?, ?, 'new')`
      )
        .bind(createdAt, name, phone, lead.age, lead.car, lead.photos)
        .run();

      const newId = Number(inserted.meta?.last_row_id ?? 0);
      if (newId > 0) lead = { ...lead, id: newId };
    } catch {
      // Мовчки: причина цікава нам, а не людині, яка чекає на відповідь
    }
  }

  if (lead.id === 0) notes.push('⚠️ Заявку не збережено');

  // ── 6. Відправка в Telegram ─────────────────────────────
  //
  // Спершу знімки, далі картка окремим повідомленням. До альбому
  // Telegram не дозволяє прикріпити кнопки, тож картка однакова для
  // заявки з фото і без — один шлях у коді замість двох.
  //
  // parse_mode не задається навмисно. Картка містить текст, який
  // вписала людина, і з розміткою ім'я на кшталт «<b» ламало б усе
  // повідомлення або ховало частину заявки.
  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

  try {
    if (hasPhoto) {
      const tg = new FormData();
      tg.set('chat_id', env.TELEGRAM_CHAT_ID);

      let photoRes: Response;
      if (photos.length === 1) {
        tg.set('photo', photos[0], 'skol.jpg');
        photoRes = await fetch(`${api}/sendPhoto`, { method: 'POST', body: tg });
      } else {
        const media = photos.map((_, i) => ({
          type: 'photo',
          media: `attach://skol-${i + 1}`,
        }));
        tg.set('media', JSON.stringify(media));
        photos.forEach((p, i) => tg.set(`skol-${i + 1}`, p, `skol-${i + 1}.jpg`));
        photoRes = await fetch(`${api}/sendMediaGroup`, { method: 'POST', body: tg });
      }

      // Telegram інколи відхиляє зображення (формат, розмір). Заявку
      // це не спиняє — картка йде в будь-якому разі, але оператор має
      // побачити, що з фото щось не так.
      if (!photoRes.ok) {
        notes.push('⚠️ Фото не передалося — передзвоніть і попросіть надіслати');
      }
    }

    if (oversized > 0) {
      notes.push(`⚠️ Не вмістилося знімків: ${oversized} — передзвоніть і попросіть надіслати`);
    }

    const res = await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: cardText(lead, notes),
        // Кнопки має сенс малювати лише тоді, коли є що міняти:
        // без рядка в базі натискання нікуди не запишеться
        ...(lead.id > 0 ? { reply_markup: keyboard(lead) } : {}),
      }),
    });

    if (!res.ok) return fail(502, html);

    // Запамʼятовуємо, яке саме повідомлення перемальовувати
    if (env.DB && lead.id > 0) {
      try {
        const sent = (await res.json()) as {
          result?: { message_id?: number; chat?: { id?: number } };
        };
        const messageId = sent.result?.message_id;
        const chatId = sent.result?.chat?.id;
        if (messageId && chatId) {
          await env.DB.prepare('UPDATE leads SET chat_id = ?, message_id = ? WHERE id = ?')
            .bind(String(chatId), messageId, lead.id)
            .run();
        }
      } catch {
        // Картка вже дійшла; кнопки просто не спрацюють — це
        // видно одразу, і краще за втрачену заявку
      }
    }
  } catch {
    return fail(502, html);
  }

  return ok(html);
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : fail(405, wantsHtml(request));
