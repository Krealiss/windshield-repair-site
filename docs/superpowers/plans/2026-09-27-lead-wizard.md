# Заявка по кроках — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перетворити односкранову форму заявки на майстер із чотирьох кроків — фото, давність пошкодження, марка з роком, ім'я з телефоном — так, щоб без JS вона й далі працювала.

**Architecture:** Один `<form>`, кроки — `<fieldset>` усередині нього. Уся розмітка присутня завжди; скрипт ховає всі кроки, крім поточного, і малює навігацію з прогресом. Функція `/api/lead` приймає три нові поля, збирає повідомлення лише з заповненого й відповідає перенаправленням, коли запит прийшов не від скрипта.

**Tech Stack:** Astro 7.3.2, Cloudflare Pages Functions (`functions/api/lead.ts`), Telegram Bot API. Нових залежностей план не додає.

**Spec:** `docs/superpowers/specs/2026-09-27-lead-wizard-design.md`

## Global Constraints

- **Тестового фреймворку в проєкті немає.** Перевірка завдання — команда з очікуваним виводом, а не автотест. Не додавати vitest/jest/playwright.
- **Нових залежностей не додавати.** `package.json` лишається без змін.
- **Бюджет Lighthouse** (`lighthouserc.json`, дослівно): `categories:performance` ≥ 0.95, `categories:accessibility` ≥ 0.95, `categories:seo` = 1, `largest-contentful-paint` ≤ 2000 мс, `cumulative-layout-shift` ≤ 0.02.
- **`npm run build` мусить і далі падати** на чотирьох заглушках (телефон/Viber, Telegram, адреса, дані ФОП). Прев'ю — `npm run build:preview`.
- **Жодного `#rrggbb` поза `src/layouts/Base.astro`.** Виняток — фірмові кольори чужих брендів із коментарем; цього плану вони не стосуються.
- **Обов'язкові поля — тільки `name`, `phone`, `consent`.** Кроки 1–3 пропускаються одним натисканням і не валідуються взагалі.
- **Імена полів форми** (межа між компонентом і функцією, змінювати не можна): `photo`, `age`, `car`, `name`, `phone`, `consent`, `company` (пастка для ботів), `elapsed`, `page`.
- **Три допустимі значення `age`**, дослівно: `До 2 днів`, `Тиждень`, `Більше тижня`.
- **Обіцянка, дослівно:** `Передзвонимо протягом 15 хвилин, а якщо вже пізно — наступного дня в робочі години.`
- **Повідомлення в Telegram іде без `parse_mode`.** Не додавати його: тоді ім'я або марка, вписані людиною, зможуть зламати розмітку повідомлення.
- **Порожні поля в повідомленні не згадуються взагалі** — ні прочерком, ні словом «не вказано».
- **Ціль дотику ≥ 44px, кегль полів вводу 16px** (менше — iOS зумить сторінку на фокусі).
- Коментарі й видимий текст українською.
- Кожен коміт закінчується рядком `Co-Authored-By` тієї моделі, яка його робить.

## Що вирішено заздалегідь

Три рішення, які реалізатор інакше прийматиме сам і, найімовірніше, інакше.

**Спалах усіх чотирьох кроків при завантаженні лишаємо.** Скрипт Astro — модуль, тобто виконується після розбору HTML, і до того моменту видно всі кроки. Прибрати це можна лише інлайновим скриптом у `<head>`, який ставить клас на `<html>`, — тобто рендер-блокуючим запитом заради косметики в блоці, що лежить далеко під першим екраном. CLS від цього не страждає: зсув відбувається поза видимою областю, а Lighthouse міряє при прокрутці вгорі.

**Картці задається мінімальна висота.** Крок із фотографією вищий за крок із трьома радіокнопками; без мінімальної висоти картка стрибає, і кнопка «Далі» тікає з-під пальця. Значення підбирається вимірюванням у Задачі 3.

**Файл лишається одним.** Після всіх правок `LeadForm.astro` — близько 450 рядків. Виносити скрипт у `src/lib/` немає сенсу: у нього рівно один споживач, і межа між файлами тут була б формальною.

## Файли

| Файл | Що з ним | Відповідальність після змін |
|---|---|---|
| `functions/api/lead.ts` | переписати | Приймання заявки, валідація, повідомлення в Telegram, відповідь скрипту й браузеру |
| `src/components/LeadForm.astro` | переписати розмітку, стилі й скрипт | Майстер із чотирьох кроків |
| `src/pages/thanks.astro` | один рядок тексту | Сторінка подяки |

---

### Task 1: Функція приймає три нові поля

Сервер першим: коли він готовий, клієнтську частину можна перевіряти наскрізь, а не «на слово».

**Files:**
- Modify: `functions/api/lead.ts` (переписати цілком)

**Interfaces:**
- Consumes: нічого
- Produces:
  - приймає поля `name` (обов'язкове), `age`, `car` на додачу до наявних `phone`, `photo`, `consent`, `company`, `elapsed`, `page`
  - при заголовку `Accept`, що містить `text/html`, відповідає `303` на `/thanks/` замість `{"ok":true}`
  - Задача 3 надсилає `Accept: application/json` і отримує стару поведінку

- [ ] **Step 1: Переписати `functions/api/lead.ts`**

Файл замінюється цілком.

```ts
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
    .replace(/[ -]+/g, ' ')
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
```

- [ ] **Step 2: Підняти локальний сервер із функціями**

У сесії вже може бути піднятий `wrangler` на порту 8788. Перевір:

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8788/`
Expected: `200`. Якщо ні — зібрати й підняти:

```bash
npm run build:preview
npx wrangler pages dev dist --port 8788 --compatibility-date=2026-09-08 --kv RATE
```

`.dev.vars` у корені проєкту вже містить справжні токени, і wrangler підхоплює їх сам. **Токен нікуди не виводь і не друкуй.**

- [ ] **Step 3: Заявка без імені відхиляється**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8788/api/lead \
  -F "phone=+380671234567" -F "elapsed=9999"
```
Expected: `400`. Ім'я обов'язкове.

- [ ] **Step 4: Заявка з поганим телефоном відхиляється**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8788/api/lead \
  -F "name=ТЕСТ" -F "phone=0671234567" -F "elapsed=9999"
```
Expected: `400`. Формат строгий: `+380` і дев'ять цифр.

- [ ] **Step 5: Повна заявка доходить до Telegram**

**Увага: це надсилає справжнє повідомлення власнику.** Тому ім'я починається зі слова ТЕСТ — щоб його було видно й не переплутати із заявкою від людини.

Run:
```bash
curl -s -X POST http://127.0.0.1:8788/api/lead \
  -F "name=ТЕСТ Задача 1" -F "phone=+380671234567" \
  -F "age=Тиждень" -F "car=Skoda Octavia 2016" -F "elapsed=9999" -F "page=/"
```
Expected: `{"ok":true}`. У Telegram приходить повідомлення, де є рядки `Ім'я`, `Телефон`, `Давність`, `Авто`, `Сторінка`, `Час` і `Без фото`.

- [ ] **Step 6: Порожні поля не згадуються**

Run:
```bash
curl -s -X POST http://127.0.0.1:8788/api/lead \
  -F "name=ТЕСТ без давності" -F "phone=+380671234567" -F "elapsed=9999"
```
Expected: `{"ok":true}`. У повідомленні **немає** рядків `Давність` і `Авто` — жодних прочерків, жодного «не вказано».

- [ ] **Step 7: Стороннє значення давності ігнорується**

Run:
```bash
curl -s -X POST http://127.0.0.1:8788/api/lead \
  -F "name=ТЕСТ чужа давність" -F "phone=+380671234567" -F "age=позавчора" -F "elapsed=9999"
```
Expected: `{"ok":true}`, і в повідомленні рядка `Давність` **немає**: значення не з переліку відкидається.

- [ ] **Step 8: Браузер без скрипта отримує перенаправлення, а не JSON**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST http://127.0.0.1:8788/api/lead \
  -H "Accept: text/html,application/xhtml+xml" \
  -F "name=ТЕСТ без JS" -F "phone=+380671234567" -F "elapsed=9999"
```
Expected: `303` і адреса, що закінчується на `/thanks/`.

Run:
```bash
curl -s -X POST http://127.0.0.1:8788/api/lead \
  -H "Accept: text/html" -F "phone=+380671234567" -F "elapsed=9999" | head -3
```
Expected: HTML-сторінка зі словами «Заявку не надіслано», а не JSON. (Ім'я не передано — заявка невалідна.)

- [ ] **Step 9: Коміт**

```bash
git add functions/api/lead.ts
git commit -m "Функція заявки приймає ім'я, давність і марку"
```

---

### Task 2: Чотири кроки в розмітці

Після цієї задачі форма працює без JS саме так, як вимагає специфікація: видно всі чотири блоки, одна кнопка відправки. Скрипт ще старий — він не знає про кроки, але всі ідентифікатори, за які він тримається, на місці, тож форма лишається робочою.

**Files:**
- Modify: `src/components/LeadForm.astro` — розмітка (рядки 19–83) і блок `<style>` (рядки 85–160); `<script>` не чіпати
- Modify: `src/pages/thanks.astro:35`

**Interfaces:**
- Consumes: функцію з Задачі 1 — поля `name`, `age`, `car`
- Produces (Задача 3 тримається за це):
  - `<fieldset class="lead__step">` × 4 у порядку кроків
  - `<legend class="lead__q" tabindex="-1">` у кожному кроці
  - `#lead-progress`, `#lead-step-of`, `#lead-bar-fill` — прогрес, у розмітці з `hidden`
  - `#lead-back`, `#lead-next` — кнопки навігації, у розмітці з `hidden`
  - `#lead-submit` — кнопка відправки, у розмітці **видима** (це стан без JS)
  - `#lead-name`, `#lead-phone`, `#lead-photo`, `#lead-consent`, `#lead-photo-info`, `#lead-status` — без змін імен

- [ ] **Step 1: Замінити розмітку секції**

У `src/components/LeadForm.astro` замінити все від `<section class="band band--tint lead" id="lead">` до закриваючого `</section>` на:

```astro
<section class="band band--tint lead" id="lead">
  <h2 class="lead__title">Не впевнені, чи ремонтується ваш скол?</h2>
  <p class="lead__sub">
    Передзвонимо протягом 15 хвилин, а якщо вже пізно — наступного дня
    в робочі години.
  </p>

  <!--
    Справжній <form>, а не набір полів у <div>.

    Річ не в семантиці: без нього Enter у полі телефона (кнопка «Готово»
    на мобільній клавіатурі) не робив нічого, і частина людей вважала
    форму зламаною.

    method і action заповнені на випадок, коли скрипт не приїхав: тоді
    браузер надсилає форму сам, з усіма чотирма кроками одразу, і
    функція відповідає перенаправленням на сторінку подяки. Без
    method="post" браузер зробив би GET і виставив чужий номер телефона
    в адресний рядок.
  -->
  <form
    class="lead__fields"
    id="lead-form"
    method="post"
    action="/api/lead"
    enctype="multipart/form-data"
    novalidate
  >
    <!-- Прогрес має сенс лише тоді, коли кроки справді по одному,
         тому його показує скрипт -->
    <div class="lead__progress" id="lead-progress" hidden>
      <p class="lead__step-of" id="lead-step-of">Крок 1 з 4</p>
      <div class="lead__bar" aria-hidden="true"><span id="lead-bar-fill"></span></div>
    </div>

    <!--
      Кожен крок — fieldset із питанням у legend. Читалка екрана
      вимовляє legend перед полями всередині, тож людина чує питання,
      а не голий набір варіантів.

      tabindex="-1" на legend — щоб скрипт міг перевести туди фокус
      при зміні кроку. Мишею й клавіатурою він лишається недосяжним.
    -->
    <fieldset class="lead__step">
      <legend class="lead__q" tabindex="-1">Фото сколу</legend>
      <input id="lead-photo" name="photo" type="file" accept="image/*" capture="environment" />
      <p class="lead__hint" id="lead-photo-info" hidden></p>
      <p class="lead__hint">Не обов'язково — можна пропустити.</p>
    </fieldset>

    <fieldset class="lead__step">
      <legend class="lead__q" tabindex="-1">Як давно пошкодили скло?</legend>
      <label class="lead__opt">
        <input type="radio" name="age" value="До 2 днів" />
        <span>До 2 днів</span>
      </label>
      <label class="lead__opt">
        <input type="radio" name="age" value="Тиждень" />
        <span>Тиждень</span>
      </label>
      <label class="lead__opt">
        <input type="radio" name="age" value="Більше тижня" />
        <span>Більше тижня</span>
      </label>
      <p class="lead__hint">Не обов'язково — можна пропустити.</p>
    </fieldset>

    <fieldset class="lead__step">
      <legend class="lead__q" tabindex="-1">Марка та рік випуску</legend>
      <label class="lead__label" for="lead-car">Автомобіль</label>
      <input
        id="lead-car"
        name="car"
        type="text"
        autocomplete="off"
        maxlength="80"
        placeholder="Напр. Skoda Octavia 2016"
      />
      <p class="lead__hint">Не обов'язково — можна пропустити.</p>
    </fieldset>

    <fieldset class="lead__step">
      <legend class="lead__q" tabindex="-1">Як до вас звертатися?</legend>

      <label class="lead__label" for="lead-name">Ім'я</label>
      <input
        id="lead-name"
        name="name"
        type="text"
        autocomplete="given-name"
        maxlength="80"
        required
      />

      <label class="lead__label" for="lead-phone">Телефон</label>
      <input
        id="lead-phone"
        name="phone"
        type="tel"
        inputmode="tel"
        autocomplete="tel"
        placeholder="+380 __ ___ __ __"
        required
      />

      <!--
        Прапорець і підпис — сусіди, а не вкладені один в одного.
        Посилання всередині <label> відкривало б політику і водночас
        перемикало згоду: людина натискає «почитати» і не помічає,
        що зняла галочку.
      -->
      <div class="lead__consent">
        <input id="lead-consent" name="consent" type="checkbox" required />
        <label for="lead-consent">Погоджуюсь на обробку персональних даних</label>
      </div>
      <p class="lead__policy">
        <a href="/polityka-konfidentsiynosti/">Що ми робимо з вашим номером</a>
      </p>
    </fieldset>

    <!-- Honeypot: реальна людина цього поля не бачить, бот заповнює -->
    <div class="lead__trap" aria-hidden="true">
      <label for="lead-company">Компанія</label>
      <input id="lead-company" name="company" type="text" tabindex="-1" autocomplete="off" />
    </div>

    <!--
      Кнопки навігації приховані в розмітці, а кнопка відправки — ні.
      Це і є стан без JS: усі чотири кроки видно, і одна кнопка їх
      надсилає. Скрипт міняє видимість на протилежну.
    -->
    <div class="lead__nav">
      <button class="btn btn--ghost" id="lead-back" type="button" hidden>← Назад</button>
      <button class="btn btn--primary" id="lead-next" type="button" hidden>Далі →</button>
      <button class="btn btn--primary" id="lead-submit" type="submit" data-cta={placement}>
        Залишити заявку
      </button>
    </div>

    <p class="lead__status" id="lead-status" role="status" aria-live="polite"></p>
  </form>
</section>
```

- [ ] **Step 2: Замінити блок `<style>`**

Увесь блок `<style>` у `LeadForm.astro` замінюється на:

```astro
<style>
  /*
    Один із тих рядків, без яких не працює нічого.

    Атрибут hidden ховає елемент правилом display: none у стилях
    браузера. Будь-яке наше display перемагає його — авторські стилі
    сильніші за браузерні незалежно від специфічності. А display у нас
    є і в кроків (grid), і в кнопок (клас .btn ставить inline-flex).
    Без цього рядка hidden не ховає ні кроки, ні кнопки.
  */
  [hidden] { display: none !important; }

  .lead__trap {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  /*
    minmax(0, 1fr), а не типове auto: у input[type=file] велика власна
    мінімальна ширина, і колонка розтягувалася під нього, виносячи
    всю секцію за екран на вузьких телефонах.
  */
  .lead {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.4rem;
    justify-items: start;
  }

  .lead__title {
    margin: 0;
    font-size: clamp(1.4rem, 4.5vw, 1.85rem);
    line-height: 1.2;
    letter-spacing: -0.02em;
    text-wrap: balance;
    max-width: 24ch;
  }
  .lead__sub { margin: 0 0 0.9rem; color: var(--muted); max-width: 46ch; }

  /* Форма — біла картка на кольоровій смузі: око саме знаходить,
     де тут потрібно щось зробити */
  .lead__fields {
    display: grid;
    gap: 0.75rem;
    width: 100%;
    max-width: 30rem;
    padding: 1.25rem;
    border: 1px solid var(--accent-line);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow);
    /* Скрипт прокручує сюди при зміні кроку, а шапка липка —
       без цього відступу картка ховалася б під нею */
    scroll-margin-top: calc(var(--hdr-h) + 1rem);
    /* Кроки різної висоти. Без мінімальної висоти картка стрибає при
       кожному переході, і кнопка «Далі» тікає з-під пальця.
       Значення — висота найвищого кроку, виміряна в Задачі 3. */
    min-height: 19rem;
  }

  .lead__progress { display: grid; gap: 0.4rem; }
  .lead__step-of { margin: 0; font-size: 0.8rem; font-weight: 600; color: var(--muted); }
  .lead__bar {
    height: 4px;
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    overflow: hidden;
  }
  .lead__bar span {
    display: block;
    height: 100%;
    width: 25%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.2s ease-out;
  }

  /*
    min-width: 0 обов'язково: у fieldset власна мінімальна ширина за
    вмістом, і на вузькому екрані він розпирає картку так само, як
    колись input[type=file] розпирав усю секцію.
  */
  .lead__step {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    display: grid;
    gap: 0.5rem;
  }

  /*
    legend стилізується обережно. У нього особливий режим відображення,
    і спроби зробити з нього звичайний блок дають різний результат у
    різних браузерах. Міняємо тільки кегль, вагу й відступ — це
    працює скрізь.
  */
  .lead__q {
    padding: 0;
    margin-bottom: 0.2rem;
    font-size: 1.05rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  /* Варіант відповіді — ціла смужка, а не сама крапка радіокнопки:
     48px висоти і весь рядок як ціль дотику */
  .lead__opt {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
    font-size: 0.98rem;
  }
  .lead__opt input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--accent); }
  /* Підсвітка обраного. Якщо браузер не розуміє :has, зникає лише
     підсвітка — сама радіокнопка лишається позначеною */
  .lead__opt:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }

  .lead__label { font-size: 0.9rem; font-weight: 600; }
  .lead__hint { font-size: 0.8rem; color: var(--muted); margin: 0; }
  .lead__consent { display: flex; gap: 0.55rem; align-items: flex-start; margin-top: 0.35rem; }
  .lead__consent input { margin: 0.2rem 0 0; width: 18px; height: 18px; accent-color: var(--accent); }
  .lead__consent label { font-size: 0.85rem; line-height: 1.45; }
  .lead__policy { margin: 0; font-size: 0.85rem; }
  .lead__policy a { color: var(--accent); }

  input[type='tel'], input[type='text'], input[type='file'] {
    min-height: 48px;
    padding: 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--surface);
    font-size: 16px; /* менше 16px — iOS зумить сторінку при фокусі */
    font-family: inherit;
    color: inherit;
    width: 100%;
    min-width: 0;
  }
  input[type='file'] { padding: 0.6rem 0.8rem; font-size: 0.9rem; }
  input[type='tel']:focus-visible,
  input[type='text']:focus-visible,
  input[type='file']:focus-visible { outline-offset: 1px; }
  input[aria-invalid='true'] { border-color: var(--danger); background: var(--danger-soft); }

  .lead__nav { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.25rem; }
  .lead__nav .btn { flex: 1 1 8rem; }
  .lead__nav .btn[disabled] { opacity: 0.6; }

  .lead__status { font-size: 0.9rem; line-height: 1.45; min-height: 1.2em; margin: 0; color: var(--text); }
</style>
```

- [ ] **Step 3: Обіцянка на сторінці подяки**

`src/pages/thanks.astro`, рядок 35 — замінити:

```astro
    <p>Передзвонимо протягом 15 хвилин, а якщо вже пізно — наступного дня в робочі години.</p>
```

Стара фраза («Передзвоню протягом 15 хвилин у робочий час») суперечила б новому підзаголовку форми: людина прочитала б дві різні обіцянки підряд.

- [ ] **Step 4: Збірка і стан без JS у розмітці**

Run: `npm run build:preview`
Expected: успішно.

Run:
```bash
node -e "
const h = require('fs').readFileSync('dist/index.html','utf8');
const steps = h.match(/<fieldset[^>]*lead__step/g) || [];
console.log('кроків:', steps.length);
console.log('прихованих кроків:', (h.match(/<fieldset[^>]*lead__step[^>]*hidden/g)||[]).length);
console.log('кнопка відправки прихована:', /id=\"lead-submit\"[^>]*hidden/.test(h));
console.log('назад прихована:', /id=\"lead-back\"[^>]*hidden/.test(h));
console.log('далі прихована:', /id=\"lead-next\"[^>]*hidden/.test(h));
console.log('поля:', ['name=\"name\"','name=\"age\"','name=\"car\"','name=\"phone\"','name=\"consent\"','name=\"photo\"','name=\"company\"'].filter(n=>h.includes(n)).length, 'із 7');
"
```
Expected: `кроків: 4`, `прихованих кроків: 0`, `кнопка відправки прихована: false`, `назад прихована: true`, `далі прихована: true`, `поля: 7 із 7`.

Це і є стан без JS: усі кроки видно, надіслати їх можна однією кнопкою.

- [ ] **Step 5: Обіцянка стоїть у двох місцях і однакова**

Run:
```bash
node -e "
const fs=require('fs');
const p='Передзвонимо протягом 15 хвилин, а якщо вже пізно — наступного дня в робочі години.';
const norm=(s)=>s.replace(/\s+/g,' ');
for (const f of ['dist/index.html','dist/thanks/index.html']) {
  console.log(f, norm(fs.readFileSync(f,'utf8')).includes(p));
}
"
```
Expected: `true` для обох файлів.

- [ ] **Step 6: Немає горизонтальної прокрутки від 320px**

Сервер уже піднято (`http://127.0.0.1:8788`). Після перезбірки додай до адреси інший параметр (`?v=1`), інакше побачиш сторінку з кешу. На ширині 320px виконай у браузері:

```js
const f = document.getElementById('lead-form');
[document.documentElement.scrollWidth, document.documentElement.clientWidth,
 f.scrollWidth, Math.round(f.getBoundingClientRect().width)]
```
Expected: перші два числа однакові, і ширина форми не перевищує видиму. Саме тут ловиться забутий `min-width: 0` у `fieldset`.

- [ ] **Step 7: Коміт**

```bash
git add src/components/LeadForm.astro src/pages/thanks.astro
git commit -m "Розмітка заявки по кроках, без JS працює як довга форма"
```

---

### Task 3: Скрипт перегортає кроки

**Files:**
- Modify: `src/components/LeadForm.astro` — блок `<script>` замінюється цілком; розмітку й стилі не чіпати, крім одного виміряного значення `min-height`

**Interfaces:**
- Consumes: розмітку з Задачі 2 (`.lead__step`, `.lead__q`, `#lead-progress`, `#lead-step-of`, `#lead-bar-fill`, `#lead-back`, `#lead-next`, `#lead-submit`, `#lead-name`, `#lead-phone`, `#lead-photo`, `#lead-consent`, `#lead-photo-info`, `#lead-status`); функцію з Задачі 1
- Produces: подію аналітики `form_step` із номером кроку; заявку з полями `name`, `age`, `car`, `phone`, `photo`

- [ ] **Step 1: Замінити блок `<script>`**

```astro
<script>
  const $ = (id: string) => document.getElementById(id);
  const form = $('lead-form') as HTMLFormElement | null;
  const steps = Array.from(document.querySelectorAll<HTMLFieldSetElement>('.lead__step'));
  const progress = $('lead-progress');
  const stepOf = $('lead-step-of');
  const barFill = $('lead-bar-fill');
  const back = $('lead-back') as HTMLButtonElement | null;
  const next = $('lead-next') as HTMLButtonElement | null;
  const submit = $('lead-submit') as HTMLButtonElement | null;
  const status = $('lead-status');
  const nameEl = $('lead-name') as HTMLInputElement | null;
  const phone = $('lead-phone') as HTMLInputElement | null;
  const photo = $('lead-photo') as HTMLInputElement | null;
  const consent = $('lead-consent') as HTMLInputElement | null;
  const info = $('lead-photo-info');

  const MAX_EDGE = 1600;
  const TOTAL = steps.length;
  const openedAt = Date.now();
  let current = 1;

  /** Стискання на клієнті: 8 МБ → ~300 КБ.
      Знімок із сучасного телефона на мобільному інтернеті вантажиться
      30+ секунд, і людина йде, не дочекавшись. */
  async function shrink(file: File): Promise<Blob> {
    if (!file.type.startsWith('image/')) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 900_000) return file;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, 'image/jpeg', 0.82)
      );
      return blob ?? file;
    } catch {
      return file; // старий браузер — шлемо оригінал
    }
  }

  /** Перемальовує крок. moveFocus=false лише на першому показі:
      забирати фокус у людини, яка щойно відкрила сторінку, не можна. */
  function render(moveFocus: boolean) {
    steps.forEach((s, i) => {
      s.hidden = i + 1 !== current;
    });
    if (stepOf) stepOf.textContent = `Крок ${current} з ${TOTAL}`;
    if (barFill) barFill.style.width = `${(current / TOTAL) * 100}%`;
    if (back) back.hidden = current === 1;
    if (next) next.hidden = current === TOTAL;
    if (submit) submit.hidden = current !== TOTAL;

    if (!moveFocus) return;
    // Фокус на питання нового кроку. Без цього людина з читалкою не
    // дізнається, що екран змінився, а Tab піде з елемента, якого
    // вже немає на екрані.
    steps[current - 1]?.querySelector<HTMLElement>('.lead__q')?.focus();
  }

  function go(delta: number) {
    const target = Math.min(TOTAL, Math.max(1, current + delta));
    if (target === current) return;
    current = target;
    render(true);

    // Прокручуємо тільки коли верх картки пішов за межі екрана —
    // інакше сторінка смикається там, де й так усе видно
    if (form && form.getBoundingClientRect().top < 0) {
      form.scrollIntoView({ block: 'start' });
    }

    // Без цієї події неможливо дізнатися, на якому екрані люди йдуть,
    // а це головне питання до будь-якого майстра
    window.dataLayer?.push({
      event: 'form_step',
      step: current,
      page_path: location.pathname,
    });
  }

  // Скрипт приїхав: показуємо прогрес і лишаємо один крок.
  // До цієї миті видно всі чотири — саме так форма працює без JS.
  if (form && TOTAL > 1) {
    if (progress) progress.hidden = false;
    render(false);
    next?.addEventListener('click', () => go(1));
    back?.addEventListener('click', () => go(-1));
  }

  photo?.addEventListener('change', () => {
    const f = photo.files?.[0];
    if (!f || !info) return;
    info.hidden = false;
    info.textContent = `Обрано: ${f.name}`;
  });

  /** Повідомлення + фокус на проблемному полі: інакше людина бачить
      текст помилки, але не бачить, куди він показує */
  function fail(msg: string, focus?: HTMLElement | null) {
    if (status) status.textContent = msg;
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Залишити заявку';
    }
    focus?.focus();
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Enter у текстовому полі надсилає форму. Поки кроки не пройдені,
    // це має вести далі, а не відправляти напівпорожню заявку.
    if (current < TOTAL) {
      go(1);
      return;
    }

    const nameValue = (nameEl?.value ?? '').trim();
    if (!nameValue) {
      nameEl?.setAttribute('aria-invalid', 'true');
      return fail('Як до вас звертатися?', nameEl);
    }
    nameEl?.removeAttribute('aria-invalid');

    const value = (phone?.value ?? '').replace(/[^\d+]/g, '');
    if (!/^\+?380\d{9}$/.test(value)) {
      phone?.setAttribute('aria-invalid', 'true');
      return fail('Перевірте номер телефона', phone);
    }
    phone?.removeAttribute('aria-invalid');

    if (!consent?.checked) return fail('Потрібна згода на обробку даних', consent);

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Надсилаю…';
    }
    if (status) status.textContent = '';

    const fd = new FormData(form);
    fd.set('name', nameValue);
    fd.set('phone', value.startsWith('+') ? value : `+${value}`);
    fd.set('elapsed', String(Date.now() - openedAt)); // боти сабмітять миттєво
    fd.set('page', location.pathname);

    const file = photo?.files?.[0];
    if (file) fd.set('photo', await shrink(file), 'skol.jpg');

    try {
      // Заголовок явний: функція за ним відрізняє скрипт від браузера,
      // який надсилає форму сам, і другому відповідає перенаправленням
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: fd,
      });
      if (!res.ok) throw new Error(String(res.status));
      window.dataLayer?.push({ event: 'form_submit', page_path: location.pathname });
      location.href = '/thanks/';
    } catch {
      fail('Не вдалося надіслати. Зателефонуйте, будь ласка — так швидше.');
    }
  });
</script>
```

- [ ] **Step 2: Зібрати й виміряти висоту кроків**

Run: `npm run build:preview`
Expected: успішно.

Далі в браузері на ширині 390px, сторінка `http://127.0.0.1:8788/?v=2`:

```js
const steps = [...document.querySelectorAll('.lead__step')];
const f = document.getElementById('lead-form');
const keep = f.style.minHeight;
f.style.minHeight = '0';           // міряємо власну висоту кроків, а не задану
const out = [];
for (let i = 0; i < steps.length; i++) {
  steps.forEach((s, j) => { s.hidden = j !== i; });
  out.push(Math.round(f.getBoundingClientRect().height));
}
f.style.minHeight = keep;
({ heights: out, max: Math.max(...out), rem: (Math.ceil(Math.max(...out) / 4) * 4) / 16 })
```
Expected: чотири власні висоти кроків і порахований `rem`.

Підстав отримане `rem` у `min-height` правила `.lead__fields` замість `19rem`, перезбери й **перезавантаж сторінку** (виміри залишають кроки в неправильному стані). Потім перевір, що картка більше не змінює висоту:

```js
const f = document.getElementById('lead-form');
const h = [];
for (let i = 0; i < 3; i++) { h.push(Math.round(f.getBoundingClientRect().height)); document.getElementById('lead-next').click(); }
h.push(Math.round(f.getBoundingClientRect().height));
h
```
Expected: чотири однакові числа.

- [ ] **Step 3: Пройти всі чотири кроки з клавіатури**

Без миші, на ширині 390px. Це єдиний спосіб перевірити фокус — очима він не видно.

1. Tab до кнопки «Далі» → `document.activeElement.id` = `lead-next`
2. Enter → `document.querySelectorAll('.lead__step:not([hidden])').length` = `1`, і `document.activeElement.classList.contains('lead__q')` = `true`
3. Повторити до четвертого кроку → `document.getElementById('lead-step-of').textContent` = `Крок 4 з 4`
4. На четвертому кроці: `document.getElementById('lead-next').hidden` = `true`, `document.getElementById('lead-submit').hidden` = `false`
5. «Назад» до третього → введене на четвертому кроці не втрачено (перевір `document.getElementById('lead-name').value` після повернення вперед)
6. На першому кроці `document.getElementById('lead-back').hidden` = `true`

Expected: усі шість пунктів як описано.

- [ ] **Step 4: Приховані кроки не ловлять Tab**

```js
const hidden = [...document.querySelectorAll('.lead__step[hidden]')];
hidden.length + ' прихованих; фокусованих усередині них: ' +
  hidden.reduce((n, s) => n + [...s.querySelectorAll('input,button,a')].filter(el => el.offsetParent !== null).length, 0)
```
Expected: `3 прихованих; фокусованих усередині них: 0`.

- [ ] **Step 5: Enter у текстовому полі веде далі, а не надсилає**

На третьому кроці (марка) поставити фокус у поле й натиснути Enter:

```js
document.getElementById('lead-step-of').textContent
```
Expected: `Крок 4 з 4`. Заявка не відправлена, сторінка не перезавантажена.

- [ ] **Step 6: Справжня заявка з усіма полями**

Заповнити форму в браузері: фото не додавати, давність «Тиждень», марку «ТЕСТ Задача 3», ім'я «ТЕСТ Задача 3», телефон `+380671234567`, згоду поставити. Надіслати.

Expected: браузер опиняється на `/thanks/`; у Telegram приходить повідомлення з рядками `Ім'я`, `Телефон`, `Давність`, `Авто` і **без** рядка `Фото`. У консолі немає помилок.

- [ ] **Step 7: Коміт**

```bash
git add src/components/LeadForm.astro
git commit -m "Майстер заявки: кроки, прогрес, фокус і подія переходу"
```

---

### Task 4: Приймання

Нічого не реалізує. Якщо пункт падає — правка йде в той файл, де причина.

**Files:**
- Modify: нічого, крім виправлень за знайденим

**Interfaces:**
- Consumes: усе з Задач 1–3

- [ ] **Step 1: Запобіжник заглушок цілий**

Run: `npm run build`
Expected: **падає** з ненульовим кодом і перелічує чотири заглушки.

Run: `npm run build:preview`
Expected: успішно.

- [ ] **Step 2: Документація не розійшлася з кодом**

Run: `npm run validate`
Expected: код 0; у звіті лише чотири відомі заглушки; перевірка шляхів із README не скаржиться.

- [ ] **Step 3: Бюджет швидкості**

Run: `npx lhci autorun --config=lighthouserc.json`
Expected: усі перевірки пройдені — performance ≥ 0.95, accessibility ≥ 0.95, seo = 1, LCP ≤ 2000 мс, CLS ≤ 0.02.

Якщо впав саме accessibility — найімовірніша причина в полях без підпису або в `legend`, який лишився без тексту.

- [ ] **Step 4: Форма без JS**

У браузері вимкнути виконання скриптів і відкрити сторінку. Заповнити ім'я, телефон, згоду й надіслати.

Expected: видно всі чотири блоки одразу, кнопка одна, після відправки браузер опиняється на `/thanks/` — не на тексті `{"ok":true}` і не на порожній сторінці.

Якщо вимкнути скрипти інструментами не вдається, не вигадуй результат: перевір заміну заголовка через `curl` (як у Задачі 1, Крок 8) і напиши у звіті, що повна перевірка в браузері не проводилась і чому.

- [ ] **Step 5: Немає горизонтальної прокрутки від 320px**

На 320px, 360px і 390px:

```js
[document.documentElement.scrollWidth, document.documentElement.clientWidth]
```
Expected: два однакові числа на кожній ширині.

- [ ] **Step 6: Заявка з фотографією**

Через форму в браузері надіслати заявку з будь-яким зображенням, ім'я «ТЕСТ фото».

Expected: у Telegram приходить саме фотографія з підписом, а не текст; у підписі немає рядка «Без фото».

- [ ] **Step 7: Кожне поле доходить окремо**

Три заявки через форму, ім'я в кожній починається з «ТЕСТ»:
1. лише ім'я, телефон, згода → у повідомленні немає рядків `Давність`, `Авто`, і є `Без фото`
2. ім'я, телефон, давність → є `Давність`, немає `Авто`
3. ім'я, телефон, марка → є `Авто`, немає `Давність`

Expected: усі три як описано. Це перевірка головної вимоги специфікації — порожні поля не згадуються взагалі.

- [ ] **Step 8: Коміт, якщо були правки**

```bash
git add -A
git commit -m "Правки за прийманням заявки по кроках"
```

Якщо правок не було — коміта немає, і це нормальний результат.

---

## Що лишається поза цим планом

- **Обов'язкове ім'я — нова вимога.** Якщо заявок стане помітно менше, першим кандидатом на послаблення є саме воно. Подія `form_step` закладена, щоб це побачити по кроках, а не вгадувати.
- **CRM, заради якої вводиться ім'я, поки не підключена.** Поля названі так, щоб лягли в неї без перейменування.
- **Чотири заглушки досі валять `npm run build`**: телефон, адреса, Telegram, дані ФОП. Це запобіжник, а не борг цього плану.
