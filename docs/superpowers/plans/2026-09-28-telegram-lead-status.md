# Стан заявки в Telegram — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заявка приходить у Telegram читабельною карткою з кнопками стану, стан зберігається в таблиці D1, і одна заявка лишається одним повідомленням, яке переписується.

**Architecture:** Рядок у таблиці `leads` створюється до відправки — з нього беруться номер і стан. Текст картки й кнопки малює спільний модуль, який використовують обидва ендпоінти: `/api/lead` створює картку, `/api/tg` перемальовує її після натискання. Вебхук захищено секретом, який Telegram підставляє в заголовок кожного запиту.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), Telegram Bot API. Нових залежностей план не додає.

**Spec:** `docs/superpowers/specs/2026-09-28-telegram-lead-status-design.md`

## Global Constraints

- **Тестового фреймворку в проєкті немає.** Перевірка — команда з очікуваним виводом і дія в живому Telegram, а не автотест. Не додавати vitest/jest/playwright.
- **Нових залежностей не додавати.** `package.json` міняється лише новим рядком у `scripts`.
- **Токен бота й секрет вебхука ніколи не друкуються** — ні повністю, ні частинами, ні в звіті, ні у виводі скриптів.
- **Стани в базі латиницею, дослівно:** `new`, `in_work`, `done`, `declined`. Українські написи живуть у коді картки.
- **`parse_mode` не задається ніде.** Картка містить текст, який вписала людина.
- **Порожні поля в картці не згадуються взагалі** — ні прочерком, ні словом «не вказано».
- **Заявка важливіша за все інше:** якщо бази немає або запит до неї впав, заявка все одно йде в Telegram — без номера, без кнопок, із рядком `⚠️ Заявку не збережено`.
- **Вебхук відповідає 200 завжди**, окрім запиту з неправильним секретом (403). Telegram повторює доставку на будь-який інший код, і той самий натиск прилетить ще раз.
- **Секрет перевіряється до розбору тіла запиту.**
- **`npm run build` мусить і далі падати** на чотирьох заглушках. Прев'ю — `npm run build:preview`.
- **Час у базі — UTC (ISO), у картці — київський.**
- Коментарі й видимий текст українською.
- Кожен коміт закінчується рядком `Co-Authored-By` тієї моделі, яка його робить.

## Що вирішено заздалегідь

**Фото і картка — два повідомлення, завжди.** Telegram не дозволяє кнопки під альбомом. Навіть коли знімок один і `sendPhoto` кнопки дозволяє, картка все одно йде окремим текстовим повідомленням: так вигляд заявки однаковий у всіх випадках, а редагувати щоразу треба текст, а не підпис. Один шлях у коді замість двох.

**Спільний модуль лежить у `functions/_lib/`.** Cloudflare Pages не маршрутизує файли й теки, що починаються з підкреслення, — саме тому там працюють `_middleware.ts` і `_worker.js`. Задача 2 це перевіряє запитом, а не припускає.

**Номер заявки — це `id` рядка.** Тому рядок створюється до відправки: інакше в картці нема чого писати замість номера. Після відправки рядок доповнюється `message_id`.

## Файли

| Файл | Що з ним | Відповідальність |
|---|---|---|
| `migrations/0001_leads.sql` | **створити** | Схема таблиці заявок |
| `functions/_lib/card.ts` | **створити** | Текст картки і кнопки за станом |
| `functions/api/lead.ts` | правити | Приймання заявки, запис у базу, перша картка |
| `functions/api/tg.ts` | **створити** | Вебхук: зміна стану, перемальовування картки |
| `scripts/telegram-webhook.mjs` | **створити** | Реєстрація вебхука |
| `.dev.vars.example` | правити | Нова змінна |
| `package.json` | правити | Новий рядок у `scripts` |
| `README.md` | правити | Змінні, привʼязка D1, міграція, розділ про стани |

---

### Task 1: Таблиця заявок

**Files:**
- Create: `migrations/0001_leads.sql`

**Interfaces:**
- Consumes: нічого
- Produces: таблиця `leads` із полями `id`, `created_at`, `name`, `phone`, `age`, `car`, `photos`, `status`, `prev_status`, `actor_id`, `actor_name`, `updated_at`, `chat_id`, `message_id`. Задачі 2 і 3 пишуть і читають саме ці імена.

- [ ] **Step 1: Створити `migrations/0001_leads.sql`**

```sql
-- Заявки з сайту.
--
-- Це центральна сутність майбутньої CRM: клієнти й майстри
-- звʼязуватимуться саме з цими рядками. Тому поля названі так, щоб їх
-- не довелося перейменовувати, а стани зберігаються латиницею — CRM
-- не має розбирати українські написи.
--
-- Час у UTC (ISO 8601). Київський час рахується при показі: база не
-- має залежати від того, чи зараз літній час.
CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  phone        TEXT    NOT NULL,
  age          TEXT,
  car          TEXT,
  photos       INTEGER NOT NULL DEFAULT 0,

  -- new | in_work | done | declined
  status       TEXT    NOT NULL DEFAULT 'new',
  -- стан до останньої зміни: з нього працює кнопка «Повернути».
  -- Заявка потрапляє у «Відмову» і з «Нової», і з «В роботі», тож
  -- вгадати попередній стан нізвідки.
  prev_status  TEXT,

  actor_id     TEXT,
  actor_name   TEXT,
  updated_at   TEXT,

  -- Яке саме повідомлення перемальовувати при зміні стану
  chat_id      TEXT,
  message_id   INTEGER
);

-- Кожна нова заявка питає, чи цей номер уже звертався. Без індексу це
-- перебір усієї таблиці на кожній заявці.
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);

-- Те, що питатиме CRM: що зараз у роботі, що було за місяць
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
```

- [ ] **Step 2: Застосувати міграцію до локальної бази**

Локальна база живе в тому самому каталозі, що й локальний KV, — `.wrangler/state`.

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --file=migrations/0001_leads.sql
```
Expected: команда завершується успішно й повідомляє про виконані запити.

- [ ] **Step 3: Переконатися, що таблиця є і порожня**

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT COUNT(*) AS n FROM leads"
```
Expected: `n` дорівнює `0`.

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='leads'"
```
Expected: три індекси — `idx_leads_phone`, `idx_leads_status`, `idx_leads_created`.

- [ ] **Step 4: Коміт**

```bash
git add migrations/0001_leads.sql
git commit -m "Таблиця заявок у D1"
```

---

### Task 2: Заявка пишеться в базу і приходить карткою з кнопками

**Files:**
- Create: `functions/_lib/card.ts`
- Modify: `functions/api/lead.ts`

**Interfaces:**
- Consumes: таблицю `leads` із Задачі 1
- Produces (Задача 3 тримається за це):
  - `export type Status = 'new' | 'in_work' | 'done' | 'declined'`
  - `export interface LeadRow { id: number; created_at: string; name: string; phone: string; age?: string | null; car?: string | null; photos: number; status: Status; prev_status?: Status | null; actor_name?: string | null }`
  - `export function cardText(lead: LeadRow, notes?: string[]): string`
  - `export function keyboard(lead: LeadRow): { inline_keyboard: { text: string; callback_data: string }[][] }`
  - `callback_data` має вигляд `<дія>:<id>`, де дія — `work`, `done`, `decline` або `undo`
  - у базі зʼявляється рядок із заповненими `chat_id` і `message_id`

- [ ] **Step 1: Створити `functions/_lib/card.ts`**

```ts
/**
 * Текст картки заявки і кнопки під нею.
 *
 * Один модуль на двох споживачів: /api/lead малює картку вперше,
 * /api/tg перемальовує її після зміни стану. Дві копії цього коду
 * розійшлися б на першій же правці тексту — у цьому проєкті таке
 * вже траплялося з іконками соцмереж.
 *
 * Тека починається з підкреслення: Cloudflare Pages не робить із
 * таких файлів маршрутів, тож модуль лишається внутрішнім.
 */

export type Status = 'new' | 'in_work' | 'done' | 'declined';

export interface LeadRow {
  id: number;
  created_at: string;
  name: string;
  phone: string;
  age?: string | null;
  car?: string | null;
  photos: number;
  status: Status;
  prev_status?: Status | null;
  actor_name?: string | null;
}

const MARK: Record<Status, string> = {
  new: '🆕',
  in_work: '🔧',
  done: '✅',
  declined: '✖️',
};

const TITLE: Record<Status, string> = {
  new: 'Нова',
  in_work: 'В роботі',
  done: 'Виконана',
  declined: 'Відмова',
};

/** «28.09, 13:20» за київським часом із UTC-мітки в базі */
export function kyivShort(iso: string): string {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('day')}.${v('month')}, ${v('hour')}:${v('minute')}`;
}

/** «12.09» — для рядка про попереднє звернення */
export function kyivDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('day')}.${v('month')}`;
}

/**
 * Текст картки.
 *
 * notes — рядки-попередження, які додаються перед часом: про попереднє
 * звернення з того самого номера або про те, що заявку не збережено.
 *
 * id = 0 означає, що рядка в базі немає: номер у заголовку не
 * показуємо, бо його не існує.
 */
export function cardText(lead: LeadRow, notes: string[] = []): string {
  const head = lead.id > 0 ? `Заявка #${lead.id}` : 'Заявка';
  const lines = [`${MARK[lead.status]} ${head} · ${TITLE[lead.status]}`, ''];

  lines.push(lead.name, lead.phone);

  // Давність і авто — одна думка про машину, тож один рядок.
  // Порожні не згадуються взагалі.
  const about = [lead.age, lead.car].filter(Boolean).join(' · ');
  if (about) lines.push(about);

  // У новій заявці рядка немає: брати її ще ніхто не встиг
  if (lead.status !== 'new' && lead.actor_name) {
    lines.push('', `Взяв: ${lead.actor_name}`);
  }

  for (const note of notes) lines.push('', note);

  lines.push('', kyivShort(lead.created_at));
  return lines.join('\n');
}

/**
 * Кнопки залежать від стану. Фінальні лишають тільки «Повернути» —
 * без неї одне помилкове натискання назавжди заморожує заявку.
 *
 * callback_data обмежена 64 байтами, тож дія і номер, без тексту.
 */
export function keyboard(lead: LeadRow) {
  const btn = (text: string, action: string) => ({
    text,
    callback_data: `${action}:${lead.id}`,
  });

  const row =
    lead.status === 'new'
      ? [btn('🔧 В роботу', 'work'), btn('✖️ Відмова', 'decline')]
      : lead.status === 'in_work'
        ? [btn('✅ Виконано', 'done'), btn('✖️ Відмова', 'decline')]
        : [btn('↩️ Повернути', 'undo')];

  return { inline_keyboard: [row] };
}
```

- [ ] **Step 2: Додати привʼязку бази в `functions/api/lead.ts`**

У `interface Env` (рядок 14) додати поле:

```ts
interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  RATE?: KVNamespace;
  /* Знак питання навмисно: привʼязку можна забути, і це не має
     коштувати заявки — див. відправку нижче */
  DB?: D1Database;
}
```

Під наявними імпортами (файл їх поки не має — додати першим рядком після докблоку):

```ts
import { cardText, keyboard, kyivDate, type LeadRow, type Status } from '../_lib/card';
```

- [ ] **Step 3: Замінити блок відправки в `functions/api/lead.ts`**

Замінити все від рядка `// ── 5. Відправка в Telegram ─────────────────────────────` до `return ok(html);` включно на:

```ts
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

      if (photos.length === 1) {
        tg.set('photo', photos[0], 'skol.jpg');
        await fetch(`${api}/sendPhoto`, { method: 'POST', body: tg });
      } else {
        const media = photos.map((_, i) => ({
          type: 'photo',
          media: `attach://skol-${i + 1}`,
        }));
        tg.set('media', JSON.stringify(media));
        photos.forEach((p, i) => tg.set(`skol-${i + 1}`, p, `skol-${i + 1}.jpg`));
        await fetch(`${api}/sendMediaGroup`, { method: 'POST', body: tg });
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
        const sent = await res.json<{ result?: { message_id?: number; chat?: { id?: number } } }>();
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
```

Зверни увагу: `photos`, `hasPhoto`, `oversized`, `name`, `phone`, `age`, `car` оголошені вище у файлі — їх не чіпати. Рядки `const time = ...`, `const lines = [...]` і `const caption = ...` зі старого блоку зникають разом із ним: картку тепер збирає `cardText`.

- [ ] **Step 4: Підняти сервер із базою**

Якщо сервер уже працює на порту 8788, його треба перезапустити — привʼязка бази нова.

```bash
npm run build:preview
npx wrangler pages dev dist --port 8788 --compatibility-date=2026-09-08 --kv RATE --d1 DB
```

`.dev.vars` підхоплюється сам. **Токен нікуди не виводь.**

- [ ] **Step 5: Переконатися, що спільний модуль не став маршрутом**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8788/_lib/card
```
Expected: `404`. Тека з підкресленням не маршрутизується — саме на цьому тримається рішення покласти спільний код усередину `functions/`.

- [ ] **Step 6: Надіслати заявку і перевірити картку**

**Ця перевірка надсилає справжнє повідомлення власнику.** Тому ім'я починається зі слова ТЕСТ.

**Кирилицю не передавай через `curl` у цій оболонці:** складання curl для Windows бере аргументи через ANSI-API, і українські літери доїжджають як `????`. Надсилай через Node — він шле UTF-8:

```bash
node --input-type=module -e "
const fd = new FormData();
fd.set('name', 'ТЕСТ картка');
fd.set('phone', '+380671234567');
fd.set('consent', 'on');
fd.set('elapsed', '9999');
fd.set('age', 'Тиждень');
fd.set('car', 'Шкода Октавія 2016');
const r = await fetch('http://127.0.0.1:8788/api/lead', { method: 'POST', headers: { accept: 'application/json' }, body: fd });
console.log(r.status, await r.text());
"
```
Expected: `200 {\"ok\":true}`.

У Telegram приходить картка на кшталт:

```
🆕 Заявка #1 · Нова

ТЕСТ картка
+380671234567
Тиждень · Шкода Октавія 2016

28.09, 13:20
```

і під нею дві кнопки: `🔧 В роботу` і `✖️ Відмова`. Рядка `Сторінка` немає. Опиши у звіті, що саме прийшло.

- [ ] **Step 7: Переконатися, що рядок у базі заповнений**

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT id, status, name, phone, photos, chat_id, message_id FROM leads ORDER BY id DESC LIMIT 1"
```
Expected: один рядок, `status` = `new`, `chat_id` і `message_id` заповнені — без них кнопки не працюватимуть.

- [ ] **Step 8: Друга заявка з тим самим номером показує попереднє звернення**

```bash
node --input-type=module -e "
const fd = new FormData();
fd.set('name', 'ТЕСТ повтор');
fd.set('phone', '+380671234567');
fd.set('consent', 'on');
fd.set('elapsed', '9999');
const r = await fetch('http://127.0.0.1:8788/api/lead', { method: 'POST', headers: { accept: 'application/json' }, body: fd });
console.log(r.status, await r.text());
"
```
Expected: `200`, а в картці зʼявився рядок `⚠️ Цей номер уже звертався: <дата першої>`. Рядків `Давність` і `Авто` немає — їх не передавали.

- [ ] **Step 9: Заявка зі знімками — фото окремо, картка окремо**

Це найризикованіша зміна задачі: раніше підпис заявки їхав разом із фотографією, тепер він окремим повідомленням. Перевіряти обовʼязково, і саме з двома знімками — альбом іде іншим методом, ніж одиночне фото.

Зроби два невеликі знімки:

```bash
node --input-type=module -e "
import sharp from 'sharp';
const mk = (label, color, file) => sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
  .composite([{ input: Buffer.from('<svg width=\"400\" height=\"300\" xmlns=\"http://www.w3.org/2000/svg\"><text x=\"200\" y=\"160\" font-size=\"36\" fill=\"#fff\" text-anchor=\"middle\">' + label + '</text></svg>'), top: 0, left: 0 }])
  .jpeg().toFile(file);
await mk('rakurs 1', '#1d4ed8', 'tmp-1.jpg');
await mk('rakurs 2', '#0f172a', 'tmp-2.jpg');
console.log('ok');
"
```

Надішли заявку з обома:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const fd = new FormData();
fd.set('name', 'ТЕСТ два знімки');
fd.set('phone', '+380671234567');
fd.set('consent', 'on');
fd.set('elapsed', '9999');
for (const f of ['tmp-1.jpg', 'tmp-2.jpg']) {
  fd.append('photo', new Blob([readFileSync(f)], { type: 'image/jpeg' }), f);
}
const r = await fetch('http://127.0.0.1:8788/api/lead', { method: 'POST', headers: { accept: 'application/json' }, body: fd });
console.log(r.status, await r.text());
"
```
Expected: `200 {\"ok\":true}`.

У Telegram: спершу **альбом із двох знімків без підпису**, далі окремим повідомленням картка з кнопками. Підпису під фотографіями бути не повинно — він переїхав у картку. Опиши у звіті, що прийшло.

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT id, name, photos FROM leads ORDER BY id DESC LIMIT 1"
```
Expected: `photos` дорівнює `2`.

Прибери тимчасові файли:
```bash
rm -f tmp-1.jpg tmp-2.jpg
```

- [ ] **Step 10: Коміт**

```bash
git add functions/_lib/card.ts functions/api/lead.ts
git commit -m "Заявка пишеться в базу і приходить карткою з кнопками"
```

---

### Task 3: Вебхук міняє стан і перемальовує картку

**Files:**
- Create: `functions/api/tg.ts`
- Create: `scripts/telegram-webhook.mjs`
- Modify: `.dev.vars.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: `cardText`, `keyboard`, `kyivDate`, `LeadRow`, `Status` із `functions/_lib/card.ts`; таблицю `leads`; формат `callback_data` — `<дія>:<id>`, дії `work`, `done`, `decline`, `undo`
- Produces: `TELEGRAM_WEBHOOK_SECRET` як третю змінну оточення; команду `npm run telegram:webhook`

- [ ] **Step 1: Створити `functions/api/tg.ts`**

```ts
/**
 * POST /api/tg — вебхук Telegram: натискання кнопок під заявкою.
 *
 * Ендпоінт публічний, тож єдиний захист — секрет, який Telegram
 * підставляє в заголовок кожного запиту. Перевіряємо його до розбору
 * тіла: чужий запит не має дійти навіть до JSON.parse.
 *
 * Відповідаємо 200 завжди, окрім чужого секрета. Telegram повторює
 * доставку на будь-який інший код, і той самий натиск прилетить ще раз.
 *
 * Секрет (Pages → Settings → Environment variables, тип Secret):
 *   TELEGRAM_WEBHOOK_SECRET
 */
import { cardText, keyboard, kyivDate, type LeadRow, type Status } from '../_lib/card';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  DB?: D1Database;
}

/** Куди веде кожна кнопка. «Повернути» рахується окремо: цілі в нього
    немає, воно повертає в збережений попередній стан. */
const NEXT: Record<string, Status> = {
  work: 'in_work',
  done: 'done',
  decline: 'declined',
};

/** Короткий підпис, який Telegram показує спливаючою підказкою */
const TOAST: Record<Status, string> = {
  new: 'Повернуто',
  in_work: 'У роботі',
  done: 'Виконано',
  declined: 'Відмова',
};

const okEmpty = () => new Response('ok', { status: 200 });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let update: {
    callback_query?: {
      id: string;
      data?: string;
      from?: { id?: number; first_name?: string; username?: string };
    };
  };
  try {
    update = await request.json();
  } catch {
    return okEmpty();
  }

  const cq = update.callback_query;
  if (!cq?.data) return okEmpty(); // не натискання кнопки — не наша справа

  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const close = (text: string) =>
    fetch(`${api}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cq.id, text }),
    }).catch(() => {});

  const [action, rawId] = cq.data.split(':');
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !env.DB) {
    // Без бази міняти нічого: кнопка лишилась від заявки, яку не
    // зберегли. Мовчати не можна — людина бачитиме годинник, що крутиться
    await close('Заявку не збережено');
    return okEmpty();
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, created_at, name, phone, age, car, photos, status, prev_status,
              actor_name, chat_id, message_id
         FROM leads WHERE id = ?`
    )
      .bind(id)
      .first<LeadRow & { chat_id: string | null; message_id: number | null }>();

    if (!row) {
      await close('Заявку не знайдено');
      return okEmpty();
    }

    // «Повернути» веде в стан, з якого заявка пішла у фінальний.
    // Він збережений окремим полем саме тому, що з «Відмови» шлях
    // може вести і в «Нову», і в «В роботі».
    const target = action === 'undo' ? (row.prev_status ?? 'new') : NEXT[action];
    if (!target) {
      await close('Невідома дія');
      return okEmpty();
    }

    const who = cq.from?.first_name || cq.from?.username || 'невідомо';

    await env.DB.prepare(
      `UPDATE leads
          SET prev_status = status,
              status = ?,
              actor_id = ?,
              actor_name = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(target, String(cq.from?.id ?? ''), who, new Date().toISOString(), id)
      .run();

    const lead: LeadRow = { ...row, status: target, actor_name: who };

    // Рядок про попереднє звернення рахуємо заново, щоб він не зник
    // із картки після зміни стану
    const notes: string[] = [];
    const before = await env.DB.prepare(
      'SELECT created_at FROM leads WHERE phone = ? AND id <> ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(row.phone, id)
      .first<{ created_at: string }>();
    if (before) notes.push(`⚠️ Цей номер уже звертався: ${kyivDate(before.created_at)}`);

    if (row.chat_id && row.message_id) {
      const edited = await fetch(`${api}/editMessageText`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: row.chat_id,
          message_id: row.message_id,
          text: cardText(lead, notes),
          reply_markup: keyboard(lead),
        }),
      });

      // Telegram обмежує редагування старих повідомлень. Замовчувати
      // невдачу не можна: оператор натиснув і мусить побачити результат
      if (!edited.ok) {
        await fetch(`${api}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: row.chat_id,
            text: cardText(lead, notes),
            reply_markup: keyboard(lead),
          }),
        });
      }
    }

    await close(TOAST[target]);
  } catch {
    await close('Не вдалося змінити стан');
  }

  return okEmpty();
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : new Response('method not allowed', { status: 405 });
```

- [ ] **Step 2: Додати змінну в `.dev.vars.example`**

Дописати в кінець файлу:

```
# Секрет вебхука. Telegram підставляє його в заголовок кожного запиту
# на /api/tg — без нього ендпоінт відкидає запит. Вигадайте довгий
# випадковий рядок, наприклад:
#     node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
TELEGRAM_WEBHOOK_SECRET=
```

- [ ] **Step 3: Створити `scripts/telegram-webhook.mjs`**

```js
/**
 * Реєстрація вебхука Telegram.
 *
 *   npm run telegram:webhook -- https://avtoskloua.com/api/tg
 *   npm run telegram:webhook -- --delete
 *
 * Токен і секрет читаються з .dev.vars і НІКОЛИ не друкуються — ані
 * повністю, ані частинами. Той самий принцип, що й у
 * telegram-chat-id.mjs.
 *
 * Скрипт спершу показує, що зареєстровано зараз: мовчки затирати
 * чужий вебхук не можна — на ньому може працювати щось інше.
 */
import { readFileSync } from 'node:fs';

const FILE = '.dev.vars';

const die = (msg) => {
  console.error(`\n✖  ${msg}\n`);
  process.exit(1);
};

let raw;
try {
  raw = readFileSync(FILE, 'utf8');
} catch {
  die(`Немає файлу ${FILE}.\n   Створіть його зі зразка:  cp .dev.vars.example .dev.vars`);
}

const env = Object.fromEntries(
  raw
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const token = env.TELEGRAM_BOT_TOKEN;
if (!token) die(`У ${FILE} порожній TELEGRAM_BOT_TOKEN.`);

const secret = env.TELEGRAM_WEBHOOK_SECRET;
if (!secret) {
  die(
    `У ${FILE} порожній TELEGRAM_WEBHOOK_SECRET.\n` +
      '   Вигадайте довгий випадковий рядок:\n' +
      '   node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"'
  );
}

const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) die(`Telegram відмовив на ${method}: ${data.description ?? 'без пояснення'}`);
  return data.result;
};

const info = await call('getWebhookInfo');
console.log(`\nЗараз зареєстровано: ${info.url || '(нічого)'}`);
if (info.pending_update_count) {
  console.log(`Непрочитаних оновлень: ${info.pending_update_count}`);
}
if (info.last_error_message) {
  console.log(`Остання помилка доставки: ${info.last_error_message}`);
}

const arg = process.argv[2];

if (arg === '--delete') {
  await call('deleteWebhook', { drop_pending_updates: false });
  console.log('\n✓ Вебхук знято\n');
  process.exit(0);
}

if (!arg || !/^https:\/\//.test(arg)) {
  console.log(
    '\nЩоб зареєструвати, передайте адресу:\n' +
      '   npm run telegram:webhook -- https://avtoskloua.com/api/tg\n' +
      '\nЩоб зняти:\n' +
      '   npm run telegram:webhook -- --delete\n'
  );
  process.exit(0);
}

await call('setWebhook', {
  url: arg,
  secret_token: secret,
  // Нас цікавлять лише натискання кнопок. Решту Telegram навіть не
  // надсилатиме — менше зайвих запитів до ендпоінта.
  allowed_updates: ['callback_query'],
});

console.log(`\n✓ Вебхук зареєстровано: ${arg}`);
console.log('   Секрет передано Telegram — він підставлятиме його в заголовок.\n');
```

- [ ] **Step 4: Додати команду в `package.json`**

У розділ `scripts`, після `"telegram:test"`:

```json
    "telegram:webhook": "node scripts/telegram-webhook.mjs",
```

- [ ] **Step 5: Заповнити секрет у `.dev.vars`**

Згенеруй значення й впиши в `.dev.vars` рядком `TELEGRAM_WEBHOOK_SECRET=…`:

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

**Значення не друкуй у звіті.** Файл у git не потрапляє.

- [ ] **Step 6: Чужий запит не проходить**

Перезапусти сервер, щоб він підхопив нову змінну, і перевір:

```bash
curl -s -o /dev/null -w "без заголовка: %{http_code}\n" -X POST http://127.0.0.1:8788/api/tg \
  -H "content-type: application/json" -d '{"callback_query":{"id":"1","data":"done:1"}}'

curl -s -o /dev/null -w "чужий секрет: %{http_code}\n" -X POST http://127.0.0.1:8788/api/tg \
  -H "content-type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: not-the-secret" \
  -d '{"callback_query":{"id":"1","data":"done:1"}}'
```
Expected: `403` в обох випадках.

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT id, status FROM leads ORDER BY id DESC LIMIT 2"
```
Expected: стани не змінились — чужий запит нічого не зробив.

- [ ] **Step 7: Зареєструвати вебхук на тунелі й пройти цикл станів**

Локальний сервер лежить на 127.0.0.1, куди Telegram не достукається. Потрібна публічна адреса — у сесії вже піднято тунель `cloudflared`. Візьми його адресу й зареєструй:

```bash
npm run telegram:webhook -- https://<адреса-тунелю>/api/tg
```
Expected: скрипт показує, що було зареєстровано раніше, і повідомляє про успіх.

Далі в Telegram, на картці з Кроку 6 Задачі 2, натисни по черзі й після кожного натискання перевір і картку, і базу:

1. `🔧 В роботу` → картка стає `🔧 Заявка #1 · В роботі`, зʼявляється рядок `Взяв: …`, кнопки — `✅ Виконано` і `✖️ Відмова`
2. `✅ Виконано` → `✅ Заявка #1 · Виконана`, одна кнопка `↩️ Повернути`
3. `↩️ Повернути` → знову `🔧 … В роботі`

Після кожного кроку:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT id, status, prev_status, actor_name FROM leads WHERE id = 1"
```
Expected: `status` у базі збігається з тим, що показує картка.

- [ ] **Step 8: Повернення працює з обох фіналів**

На другій картці (заявка з Кроку 8 Задачі 2, вона ще `Нова`) натисни `✖️ Відмова`, потім `↩️ Повернути`.

Expected: заявка повертається в `🆕 Нова`, а не в «В роботі» — вона там ніколи не була. Це перевіряє, що `prev_status` справді використовується, а не підставляється навмання.

- [ ] **Step 9: Коміт**

```bash
git add functions/api/tg.ts scripts/telegram-webhook.mjs .dev.vars.example package.json
git commit -m "Вебхук Telegram: кнопки міняють стан заявки"
```

---

### Task 4: Документація і приймання

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: усе з Задач 1–3

- [ ] **Step 1: Оновити перелік змінних оточення в `README.md`**

Знайти блок зі змінними (розділ «Викласти зміни», підрозділ про Cloudflare Pages) і замінити його на:

```
PUBLIC_GTM_ID             — Google Tag Manager (звичайна змінна)
TELEGRAM_BOT_TOKEN        — Secret
TELEGRAM_CHAT_ID          — Secret
TELEGRAM_WEBHOOK_SECRET   — Secret
```

Рядок про привʼязку KV замінити на два:

```markdown
Привʼязки: `RATE` → KV namespace (обмеження частоти заявок),
`DB` → база D1 (заявки та їхні стани).
```

- [ ] **Step 2: Додати розділ про стани заявки**

Після наявного розділу «Telegram-бот» додати:

```markdown
### Стан заявки

Заявка приходить двома повідомленнями: знімки (якщо є) і картка з
кнопками. Розділені вони не примхи заради — Telegram не дозволяє
кнопки під альбомом фотографій.

Стани й переходи:

| Стан | Кнопки |
|---|---|
| 🆕 Нова | `В роботу` · `Відмова` |
| 🔧 В роботі | `Виконано` · `Відмова` |
| ✅ Виконана, ✖️ Відмова | `Повернути` |

Натискання переписує ту саму картку, а не надсилає нову: одна заявка —
одне повідомлення.

Усе, що сталося із заявкою, лежить у таблиці `leads` бази D1. Номер у
картці — це `id` рядка. Схема — у `migrations/0001_leads.sql`.

**Перед першим розгортанням треба створити базу й застосувати міграцію.**
Інакше кожна заявка приходитиме з рядком «⚠️ Заявку не збережено», і
ніхто цього не помітить, поки не почне рахувати.

```bash
npx wrangler d1 create avtoskloua
npx wrangler d1 execute avtoskloua --remote --file=migrations/0001_leads.sql
```

Далі в Cloudflare Pages → Settings → Functions → D1 bindings додати
привʼязку з іменем `DB` до створеної бази.

**Вебхук реєструється один раз** після того, як сайт уже на домені:

```bash
npm run telegram:webhook -- https://avtoskloua.com/api/tg
```

Скрипт спершу покаже, що зареєстровано зараз, і не затре чужий вебхук
мовчки. Зняти: `npm run telegram:webhook -- --delete`.
```

- [ ] **Step 3: Документація не розійшлася з кодом**

Run: `npm run validate`
Expected: код 0; у звіті лише чотири відомі заглушки; перевірка шляхів із README не скаржиться — отже `migrations/0001_leads.sql` і `scripts/telegram-webhook.mjs` існують саме там, де їх обіцяє README.

- [ ] **Step 4: Запобіжник і збірка сайту цілі**

Run: `npm run build`
Expected: **падає** з ненульовим кодом і перелічує чотири заглушки.

Run: `npm run build:preview`
Expected: успішно.

Run: `npx lhci autorun --config=lighthouserc.json`
Expected: усі перевірки пройдені. Сайт цей план не змінював — якщо щось впало, причина не тут, і це треба сказати у звіті окремо.

- [ ] **Step 5: Заявка без бази не зникає**

Перезапусти сервер **без** `--d1 DB`:

```bash
npx wrangler pages dev dist --port 8788 --compatibility-date=2026-09-08 --kv RATE
```

Надішли заявку тим самим способом, що в Задачі 2, Крок 6, з іменем `ТЕСТ без бази`.

Expected: `200`, картка приходить, у ній рядок `⚠️ Заявку не збережено`, номера немає (заголовок просто `🆕 Заявка · Нова`), кнопок немає.

Поверни сервер із `--d1 DB` після перевірки.

- [ ] **Step 6: Прибрати тестові заявки з бази**

Тестові рядки не мають лишатися в таблиці, з якої потім почне CRM.

Run:
```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "DELETE FROM leads WHERE name LIKE 'ТЕСТ%'"
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT COUNT(*) AS n FROM leads"
```
Expected: `n` дорівнює `0`.

Це стосується лише локальної бази. Повідомлення в Telegram лишаються — видалити їх може тільки власник.

- [ ] **Step 7: Коміт**

```bash
git add README.md
git commit -m "README: база заявок, стани і реєстрація вебхука"
```

---

## Що лишається поза цим планом

- **Причина відмови.** При натисканні `Відмова` бот міг би питати одним рядком кнопок: дорого / далеко / не ремонтується / не відповідає. Без цього «Відмова» нічого не дає статистиці, але це друга ланцюжкова взаємодія — робити її варто на обкатаній першій.
- **Підсумок за день.** О 20:00 одне повідомлення: скільки заявок, скільки виконано, скільки втрачено. Потребує розкладу, тобто окремого Worker.
- **CRM.** Клієнти, майстри, історія звернень. Таблиця `leads` — її перший камінь, і перейменовувати в ній нічого не доведеться.
- **Чотири заглушки досі валять `npm run build`**: телефон, адреса, Telegram, дані ФОП. Це запобіжник, а не борг цього плану.
