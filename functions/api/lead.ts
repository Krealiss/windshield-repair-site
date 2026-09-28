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

/**
 * Приводить текст із форми до вигляду, придатного для повідомлення.
 *
 * Будь-який пробільний символ — зокрема перенос рядка — стає звичайним
 * пробілом. Це не косметика: повідомлення в Telegram складається з
 * рядків «Поле: значення», і ім'я з переносом усередині дописало б у
 * заявку зайвий рядок, який виглядає як справжнє поле. Наприклад,
 * чужий номер телефона.
 *
 * \s у JS НЕ покриває NEL (U+0085), хоча за UAX #14 це обов'язковий
 * розрив рядка для рушіїв розкладки на базі Qt (Telegram Desktop) і
 * для Android/iOS: `\s` в ECMAScript — це фіксований список кодових
 * точок (WhiteSpace + LineTerminator), а не Unicode-властивість
 * White_Space, у яку U+0085 входить. Тому клас нижче додає його явно —
 * перевірено в Node на LF, CR, VT, FF, TAB, U+2028, U+2029, NBSP і
 * U+0085 (звіт правки: final-fix-report.md, знахідка 2).
 *
 * Довжина обрізається, бо підпис до фотографії в Telegram обмежений
 * 1024 символами, і заявка, яка через довге поле не надіслалась,
 * гірша за обрізане ім'я.
 */
const clean = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? '')
    .split(/[\s\u0085]+/)
    .join(' ')
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
  if (oversized > 0) {
    lines.push('', `⚠️ Не вмістилося знімків: ${oversized} — передзвоніть і попросіть надіслати`);
  }
  if (!hasPhoto) lines.push('', 'Без фото');
  const caption = lines.join('\n');

  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

  try {
    let res: Response;

    if (hasPhoto) {
      const tg = new FormData();
      tg.set('chat_id', env.TELEGRAM_CHAT_ID);

      if (photos.length === 1) {
        tg.set('caption', caption);
        tg.set('photo', photos[0], 'skol.jpg');
        res = await fetch(`${api}/sendPhoto`, { method: 'POST', body: tg });
      } else {
        /*
          Кілька знімків ідуть одним альбомом, а не чергою окремих
          повідомлень: інакше заявка розсипається в чаті на кілька
          записів, і підпис губиться десь між ними.

          Підпис у Telegram несе лише перший елемент альбому —
          решта йдуть без тексту, так влаштований sendMediaGroup.
          Файли додаються окремими полями, а media посилається на
          них через attach://.
        */
        const media = photos.map((_, i) => ({
          type: 'photo',
          media: `attach://skol-${i + 1}`,
          ...(i === 0 ? { caption } : {}),
        }));
        tg.set('media', JSON.stringify(media));
        photos.forEach((p, i) => tg.set(`skol-${i + 1}`, p, `skol-${i + 1}.jpg`));
        res = await fetch(`${api}/sendMediaGroup`, { method: 'POST', body: tg });
      }

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
