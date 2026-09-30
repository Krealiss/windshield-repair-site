# CRM, перший кусок: заявки і клієнти — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Робочий інструмент власника окремо від сайту: список заявок із
пошуком, історія клієнта за номером, запис на час і закриття роботи з
сумою — із входом через Telegram.

**Architecture:** Окремий Cloudflare Worker у теці `crm/` того самого
репозиторію, спільна база D1 із сайтом. Текст картки й логіка її
перемальовування піднімаються в кореневий `shared/`, звідки їх
імпортують і Pages Functions сайту, і Worker CRM — щоб два інтерфейси,
які правлять одні рядки, не розійшлися. Серверна відрисовка HTML, стану
на клієнті немає.

**Tech Stack:** Cloudflare Workers, Hono, D1 (SQLite), TypeScript,
Telegram Login Widget, WebCrypto (HMAC-SHA256).

**Spec:** `docs/superpowers/specs/2026-09-30-crm-leads-clients-design.md`

## Global Constraints

- Видимий текст і коментарі — українською, UTF-8. Стани заявки в базі —
  латиницею (`new`, `in_work`, `done`, `declined`).
- **Сайт не чіпати понад те, що названо в задачах.** `npm run build`
  мусить і далі падати (зараз — на демонстраційних відгуках);
  `npm run build:preview` збирається; `npx lhci autorun` тримає бюджет
  (performance ≥ 0.95, accessibility ≥ 0.95, seo = 1).
- **Одна тека міграцій — коренева `migrations/`.** База спільна, і
  `wrangler d1 migrations` веде таблицю застосованого всередині неї. Своєї
  теки міграцій у `crm/` немає.
- **Локальна база одна:** `.wrangler/state` у корені репозиторію.
  `wrangler d1 execute` вимагає `-c wrangler.local.toml`; Worker CRM
  запускається з `--persist-to ../.wrangler/state`.
- **Секрети лише через змінні оточення.** `.dev.vars` не читати і не
  друкувати. Валідатор проєкту шукає форму токена Telegram у файлах і
  спиняє збірку в будь-якому режимі — не обходити її.
- **Тестовий трафік у Telegram долітає в робочу групу власника.** Імʼя в
  тестовій заявці починається з `ТЕСТ`, повідомлень якнайменше, їхню
  кількість називати у звіті.
- **Гроші — цілим числом у копійках.** Перетворення в гривні лише при
  показі.
- Пʼятого стану заявки не заводити: записана заявка — це `in_work` із
  заповненим `appointment_at`.
- **Керуючі символи в перевірочних скриптах будувати через
  `String.fromCharCode()`, не escape-послідовностями.** У цьому проєкті
  `\uXXXX` уже двічі матеріалізувався справжнім байтом і мовчки ламав
  регулярку.
- Дані від людини (імʼя, авто, нотатка про роботу) не мусять уміти
  підробити рядок картки або вставити розмітку в HTML.

---

## Структура файлів

**Створюються:**

| Файл | За що відповідає |
|---|---|
| `shared/card.ts` | Текст картки, клавіатура, `clean()`, `REASONS`, формати дат. Переїжджає з `functions/_lib/card.ts` |
| `shared/notify.ts` | Перемальовування картки в Telegram: редагувати або надіслати заново й запамʼятати |
| `migrations/0004_crm.sql` | Поля `appointment_at`, `closed_at`, `amount`, `work_note`; таблиця `users` |
| `scripts/crm-seed-owner.mjs` | Заводить власника в `users` з `OWNER_TG_ID` |
| `crm/package.json`, `crm/wrangler.toml`, `crm/tsconfig.json` | Конфігурація окремого Worker |
| `crm/src/index.ts` | Застосунок Hono: маршрути й середина автентифікації |
| `crm/src/auth.ts` | Перевірка підпису Telegram Login, підписана кука сесії |
| `crm/src/db.ts` | Запити до D1: список, одна заявка, історія за номером, зміни |
| `crm/src/format.ts` | Гроші, дати, телефон — для показу |
| `crm/src/views/*.ts` | HTML: каркас, вхід, список, картка заявки, картка клієнта, сьогодні |

**Змінюються:**

| Файл | Що саме |
|---|---|
| `functions/api/lead.ts` | Шлях імпорту картки |
| `functions/api/tg.ts` | Шлях імпорту; `draw()` виноситься в `shared/notify.ts` |
| `functions/_lib/card.ts` | Видаляється |
| `tsconfig.functions.json` | Охоплює `shared/` |
| `.gitignore` | `crm/node_modules`, `crm/wrangler.local.toml`, `crm/.wrangler` |
| `package.json` | Скрипти `crm:dev`, `crm:deploy`, `crm:seed-owner` |
| `.dev.vars.example` | `SESSION_SECRET` |
| `README.md` | Розділ про CRM |

---

## Task 1: Спільний модуль картки переїжджає в `shared/`

Мета: щоб CRM малювала ту саму картку тим самим кодом, а не копією.
Копії в цьому проєкті розходились двічі.

**Files:**
- Create: `shared/card.ts` (переносом)
- Delete: `functions/_lib/card.ts`
- Modify: `functions/api/lead.ts`, `functions/api/tg.ts`, `tsconfig.functions.json`

**Interfaces:**
- Produces: модуль `shared/card.ts` з експортами
  `clean(value: unknown, max: number): string`,
  `type Status = 'new' | 'in_work' | 'done' | 'declined'`,
  `interface LeadRow`, `REASONS: string[]`,
  `kyivShort(iso: string): string`, `kyivDate(iso: string): string`,
  `cardText(lead: LeadRow, notes?: string[]): string`,
  `keyboard(lead: LeadRow): { inline_keyboard: … }`.
  Вміст файлу не змінюється — лише його розташування.

- [ ] **Step 1: Перенести файл зі збереженням історії**

```bash
git mv functions/_lib/card.ts shared/card.ts
```

- [ ] **Step 2: Виправити шлях імпорту в двох споживачах**

У `functions/api/lead.ts` і `functions/api/tg.ts` рядок імпорту
починається з `from '../_lib/card'`. Замінити на `from '../../shared/card'`.
Більше в цих файлах нічого не міняти.

- [ ] **Step 3: Розширити перевірку типів на нову теку**

У `tsconfig.functions.json` поле `include` зараз:

```json
"include": ["functions/**/*.ts"]
```

Замінити на:

```json
"include": ["functions/**/*.ts", "shared/**/*.ts"]
```

- [ ] **Step 4: Переконатися, що типи сходяться**

Run: `npm run check:functions`
Expected: команда завершується без виводу помилок, код повернення 0.

- [ ] **Step 5: Переконатися, що Pages справді збирає імпорт із теки вище**

Це не формальність: якби бандлер не бачив `shared/`, збірка мовчки
пройшла б, а функція впала б у рантаймі.

```bash
npx wrangler pages functions build --outdir /tmp/fnbuild
grep -c "Заявка #" /tmp/fnbuild/index.js
```

Expected: `Compiled Worker successfully`, а `grep` друкує число більше
за нуль — текст картки зі спільного модуля опинився в бандлі.

- [ ] **Step 6: Переконатися, що від `_lib` не лишилось згадок**

```bash
grep -rn "_lib/card" functions/ shared/ crm/ 2>/dev/null; echo "код: $?"
```

Expected: жодного рядка, `код: 1`.

- [ ] **Step 7: Коміт**

```bash
git add shared/card.ts functions/api/lead.ts functions/api/tg.ts tsconfig.functions.json
git commit -m "Картка переїжджає у спільну теку shared/"
```

---

## Task 2: Перемальовування картки — спільний модуль `notify`

Зараз функція `draw()` живе всередині `functions/api/tg.ts` і прив'язана
до його `Env`. CRM потребує рівно ту саму поведінку: відредагувати
наявне повідомлення, а якщо не вийшло — надіслати нове й запамʼятати
його. Виносимо, замість того щоб копіювати.

**Files:**
- Create: `shared/notify.ts`
- Modify: `functions/api/tg.ts`

**Interfaces:**
- Consumes: `shared/card.ts` (Task 1)
- Produces: `shared/notify.ts` з експортами:
  - `type NotifyRow = LeadRow & { chat_id: string | null; message_id: number | null; notes: string | null }`
  - `telegramApi(token: string): string` — базова адреса
  - `call(api: string, method: string, body: unknown): Promise<Response>`
  - `drawCard(db: D1Database, api: string, fallbackChatId: string | undefined, row: NotifyRow): Promise<void>`

- [ ] **Step 1: Створити `shared/notify.ts`**

```ts
/**
 * Малює картку заявки в Telegram із того, що зараз у базі.
 *
 * Спільний для двох інтерфейсів, які правлять одні й ті самі рядки:
 * бот (functions/api/tg.ts) і CRM (crm/). Дві копії цієї логіки
 * розійшлися б на першій же правці — у цьому проєкті таке вже
 * траплялося з іконками соцмереж і з розбором .dev.vars.
 */
import { cardText, keyboard, kyivDate, type LeadRow } from './card';

export type NotifyRow = LeadRow & {
  chat_id: string | null;
  message_id: number | null;
  notes: string | null;
};

export const telegramApi = (token: string) => `https://api.telegram.org/bot${token}`;

export const call = (api: string, method: string, body: unknown) =>
  fetch(`${api}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export async function drawCard(
  db: D1Database,
  api: string,
  fallbackChatId: string | undefined,
  row: NotifyRow
): Promise<void> {
  /* Попередження в картці. Перше рахуємо заново — воно залежить від
     інших рядків таблиці; решту читаємо з колонки notes.

     `created_at < ?`, а не `id <> ?`: «попереднє» звернення — те, що
     раніше за цю заявку. */
  const notes: string[] = [];
  const before = await db
    .prepare(
      'SELECT created_at FROM leads WHERE phone = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1'
    )
    .bind(row.phone, row.created_at)
    .first<{ created_at: string }>();
  if (before) notes.push(`⚠️ Цей номер уже звертався: ${kyivDate(before.created_at)}`);
  for (const note of (row.notes ?? '').split('\n')) {
    if (note.trim()) notes.push(note);
  }

  const text = cardText(row, notes);
  const markup = keyboard(row);

  let drawn = false;

  if (row.chat_id && row.message_id) {
    const edited = await call(api, 'editMessageText', {
      chat_id: row.chat_id,
      message_id: row.message_id,
      text,
      reply_markup: markup,
    });

    drawn = edited.ok;

    /* «message is not modified» — не збій: картка вже така, як треба.
       Раніше ця відмова гнала код у sendMessage, і в чаті зʼявлявся
       другий екземпляр тієї самої заявки. */
    if (!drawn) {
      const why = (await edited.json().catch(() => ({}))) as { description?: string };
      if (/message is not modified/i.test(why.description ?? '')) drawn = true;
    }
  }

  if (drawn) return;

  const chatId = row.chat_id || fallbackChatId;
  if (!chatId) return;

  const sent = await call(api, 'sendMessage', { chat_id: chatId, text, reply_markup: markup });
  if (!sent.ok) return;

  try {
    const data = (await sent.json()) as {
      result?: { message_id?: number; chat?: { id?: number } };
    };
    const messageId = data.result?.message_id;
    const newChatId = data.result?.chat?.id;
    if (messageId && newChatId) {
      await db
        .prepare('UPDATE leads SET chat_id = ?, message_id = ? WHERE id = ?')
        .bind(String(newChatId), messageId, row.id)
        .run();
    }
  } catch {
    // Картка в чаті вже є; не запамʼяталось — наступна зміна надішле
    // ще одну. Краще за втрачений стан.
  }
}
```

- [ ] **Step 2: Прибрати з `functions/api/tg.ts` власні копії**

У файлі видалити: локальні `const call = …`, `type FullRow = …`, і всю
функцію `async function draw(env, db, api, row) { … }` разом із її
докблоком. Натомість додати до імпортів:

```ts
import { call, drawCard, telegramApi, type NotifyRow } from '../../shared/notify';
```

- [ ] **Step 3: Переписати виклики в `tg.ts`**

Тип `FullRow` замінити на `NotifyRow` у всіх місцях (оголошення
`SELECT_LEAD` не змінюється; змінюються лише `.first<FullRow>()` →
`.first<NotifyRow>()`).

Рядок `const api = \`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}\`;`
замінити на:

```ts
const api = telegramApi(env.TELEGRAM_BOT_TOKEN);
```

Кожен виклик `await draw(env, db, api, X)` замінити на:

```ts
await drawCard(db, api, env.TELEGRAM_CHAT_ID, X);
```

Таких викликів три: у гілці готової причини, у `reasonFromReply` і в
кінці зміни стану.

- [ ] **Step 4: Переконатися, що типи сходяться**

Run: `npm run check:functions`
Expected: без помилок, код повернення 0.

- [ ] **Step 5: Переконатися, що бот і далі працює наскрізь**

Підняти локальний сервер і тунель, зареєструвати вебхук, надіслати
**одну** тестову заявку й натиснути дві кнопки.

```bash
npm run build:preview
npx wrangler pages dev dist --port 8788 --kv RATE --d1 DB --persist-to .wrangler/state
```

В іншому вікні — тунель і вебхук:

```bash
cloudflared tunnel --url http://127.0.0.1:8788
npm run telegram:webhook -- https://<адреса-тунелю>/api/tg
```

Заявка (імʼя обовʼязково з `ТЕСТ`):

```bash
node -e "
const fd = new FormData();
fd.set('name', 'ТЕСТ Спільний notify');
fd.set('phone', '+380671234500');
fd.set('consent', 'on');
fetch('http://127.0.0.1:8788/api/lead', { method: 'POST', body: fd })
  .then(r => console.log('HTTP', r.status));
"
```

Expected: `HTTP 200`, у групі зʼявилась картка. Натиснути «В роботу», далі
«Відмова» — картка **редагується на місці**, дублікат не зʼявляється.
Потім прибрати рядок:

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "DELETE FROM leads WHERE name LIKE 'ТЕСТ%'"
```

- [ ] **Step 6: Коміт**

```bash
git add shared/notify.ts functions/api/tg.ts
git commit -m "Перемальовування картки — у спільному модулі notify"
```

---

## Task 3: Міграція `0004` і скрипт першого користувача

**Files:**
- Create: `migrations/0004_crm.sql`, `scripts/crm-seed-owner.mjs`
- Modify: `package.json`, `.dev.vars.example`

**Interfaces:**
- Produces: у `leads` зʼявляються `appointment_at TEXT`, `closed_at TEXT`,
  `amount INTEGER`, `work_note TEXT`; таблиця
  `users (tg_id TEXT PRIMARY KEY, name TEXT, role TEXT, active INTEGER, created_at TEXT)`;
  npm-скрипт `crm:seed-owner`.

- [ ] **Step 1: Написати міграцію**

Створити `migrations/0004_crm.sql`:

```sql
-- Перший кусок CRM: поля про виконану роботу й таблиця користувачів.
--
-- SQLite не має ADD COLUMN IF NOT EXISTS, тож повторний прогін упаде з
-- «duplicate column name». Це нешкідливо й означає, що колонка вже на
-- місці; `wrangler d1 migrations apply` веде таблицю застосованого й
-- другого разу не запустить.

-- На коли записано. Порожньо — не записано. Окремого стану «записаний»
-- навмисно немає: це in_work із заповненим полем, інакше довелося б
-- чіпати клавіатуру бота.
ALTER TABLE leads ADD COLUMN appointment_at TEXT;

-- Коли роботу закрили. Окремо від updated_at, бо той міняється від
-- будь-якої дії, а звітам потрібен саме момент завершення.
ALTER TABLE leads ADD COLUMN closed_at TEXT;

-- Сума в копійках, цілим числом: гроші ніколи не рахуються дробовими,
-- і якщо колись зʼявиться сума з копійками, не доведеться мігрувати
-- живі грошові дані.
ALTER TABLE leads ADD COLUMN amount INTEGER;

-- Що зробили, вільним текстом
ALTER TABLE leads ADD COLUMN work_note TEXT;

-- Хто має доступ до CRM. Ключ — Telegram-ідентифікатор людини, той
-- самий, що пишеться в leads.actor_id, коли натискають кнопку в боті.
-- Завдяки цьому «хто взяв заявку» звʼязується між ботом і CRM без
-- жодного перевезення даних.
CREATE TABLE IF NOT EXISTS users (
  tg_id      TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  -- owner | master. Роль master поки перевіряється лише на вході:
  -- розділення прав — другий кусок
  role       TEXT    NOT NULL DEFAULT 'master',
  -- 0 — доступ знято. Перевіряється на кожному запиті, тож діє негайно
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL
);

-- Список на день: «хто записаний на сьогодні» — головний щоденний запит
CREATE INDEX IF NOT EXISTS idx_leads_appointment ON leads (appointment_at);
```

- [ ] **Step 2: Накотити локально**

```bash
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state -c wrangler.local.toml
```

Expected: `0004_crm.sql` зі статусом ✅.

- [ ] **Step 3: Переконатися, що схема справді змінилась**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "PRAGMA table_info(leads)" | grep -c "appointment_at\|closed_at\|amount\|work_note"
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "SELECT COUNT(*) AS n FROM users"
```

Expected: перший `grep` друкує `4`; другий запит повертає `n: 0` — таблиця
створена й порожня.

- [ ] **Step 4: Написати скрипт першого користувача**

Створити `scripts/crm-seed-owner.mjs`:

```js
#!/usr/bin/env node
/**
 * Заводить власника в таблицю users.
 *
 *     npm run crm:seed-owner            → локальна база
 *     npm run crm:seed-owner -- --remote → продакшн
 *
 * Навіщо скрипт, а не міграція: міграція — це чистий SQL, вона не вміє
 * читати змінні оточення, а вписати особистий номер власника у файл під
 * git означало б покласти його персональні дані в публічний репозиторій.
 *
 * Без цього рядка в CRM неможливо зайти взагалі: доступ вимагає запису
 * в users, а завести запис може лише той, хто вже зайшов.
 */
import { spawnSync } from 'node:child_process';
import { DEV_VARS as FILE, readDevVars } from './_dev-vars.mjs';

const die = (msg) => {
  console.error(`\n✖  ${msg}\n`);
  process.exit(1);
};

const remote = process.argv.includes('--remote');

const env = readDevVars(() => ({}));
const tgId = process.env.OWNER_TG_ID || env.OWNER_TG_ID;

if (!tgId) {
  die(
    `Немає OWNER_TG_ID — ні в оточенні, ні в ${FILE}.\n` +
      '   Це особистий Telegram-номер власника, не номер групи.\n' +
      '   Дізнатися: напишіть боту в особисті й запустіть\n' +
      '   npm run telegram:chat-id — ваш особистий чат буде в списку.'
  );
}

if (!/^[0-9]+$/.test(String(tgId))) {
  die(
    `OWNER_TG_ID має бути додатним числом, а не «${tgId}».\n` +
      '   Відʼємне число — це номер групи (TELEGRAM_CHAT_ID), а тут\n' +
      '   потрібен номер людини.'
  );
}

const sql =
  "INSERT INTO users (tg_id, name, role, active, created_at) " +
  `VALUES ('${tgId}', 'Власник', 'owner', 1, '${new Date().toISOString()}') ` +
  "ON CONFLICT(tg_id) DO UPDATE SET role = 'owner', active = 1";

const args = remote
  ? ['wrangler', 'd1', 'execute', 'leads', '--remote', '--command', sql]
  : [
      'wrangler', 'd1', 'execute', 'DB', '--local',
      '--persist-to', '.wrangler/state',
      '-c', 'wrangler.local.toml',
      '--command', sql,
    ];

const res = spawnSync('npx', args, { stdio: 'inherit', shell: true });
if (res.status !== 0) die('Не вдалося виконати запит до бази.');

console.log(`\n✓  Власника заведено (tg_id ${tgId}, роль owner).\n`);
```

- [ ] **Step 5: Додати скрипт у `package.json`**

У розділ `scripts` додати рядок:

```json
"crm:seed-owner": "node scripts/crm-seed-owner.mjs",
```

- [ ] **Step 6: Описати змінну в зразку**

`.dev.vars.example` уже містить `OWNER_TG_ID`. Додати під нього:

```
# Ключ, яким підписується кука сесії CRM. Будь-який довгий випадковий
# рядок; змінити його = вигнати всіх із сесій.
#     node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
SESSION_SECRET=
```

- [ ] **Step 7: Перевірити скрипт — обидві гілки**

Спершу помилку:

```bash
OWNER_TG_ID=-1004294703333 node scripts/crm-seed-owner.mjs; echo "код: $?"
```

Expected: повідомлення про те, що потрібен номер людини, `код: 1`.

Далі успіх (номер узяти з `.dev.vars`, не друкуючи файл):

```bash
npm run crm:seed-owner
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "SELECT tg_id, role, active FROM users"
```

Expected: рядок із роллю `owner` і `active: 1`.

- [ ] **Step 8: Коміт**

```bash
git add migrations/0004_crm.sql scripts/crm-seed-owner.mjs package.json .dev.vars.example
git commit -m "Міграція CRM: поля роботи, таблиця users, скрипт власника"
```

---

## Task 4: Каркас Worker

**Files:**
- Create: `crm/package.json`, `crm/wrangler.toml`, `crm/wrangler.local.toml.example`,
  `crm/tsconfig.json`, `crm/src/env.ts`, `crm/src/index.ts`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Produces: Worker, що відповідає на `GET /health`, і тип `Env` у
  `crm/src/env.ts` — його імпортують усі наступні задачі:

```ts
export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID?: string;
  SESSION_SECRET: string;
}
```

- [ ] **Step 1: Завести пакет**

Створити `crm/package.json`:

```json
{
  "name": "avtoskloua-crm",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev -c wrangler.local.toml --persist-to ../.wrangler/state --port 8789",
    "deploy": "wrangler deploy",
    "check": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.6.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Написати конфіг деплою**

Створити `crm/wrangler.toml`:

```toml
# Конфіг для розгортання CRM. Локальний запуск бере wrangler.local.toml
# (поза git) — див. README.
name = "avtoskloua-crm"
main = "src/index.ts"
compatibility_date = "2026-09-26"

# База спільна з сайтом. database_id підставляється після
# `npx wrangler d1 create leads` — до того деплой навмисно впаде,
# бо розгорнути CRM у порожнечу гірше, ніж не розгорнути.
[[d1_databases]]
binding = "DB"
database_name = "leads"
database_id = "ПІДСТАВТЕ-ID-БАЗИ"
```

Створити `crm/wrangler.local.toml.example`:

```toml
# Скопіюйте у crm/wrangler.local.toml — цей файл у git не потрапляє.
#
# database_id навмисно "DB": саме такий id підставляє
# `wrangler pages dev dist --d1 DB`, яким запускається сайт. Локальне
# сховище D1 підписане хешем цього id, тож без збігу CRM і сайт бачили б
# дві різні порожні бази.
name = "avtoskloua-crm"
main = "src/index.ts"
compatibility_date = "2026-09-26"

[[d1_databases]]
binding = "DB"
database_name = "leads"
database_id = "DB"
```

- [ ] **Step 3: Конфіг типів**

Створити `crm/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*.ts", "../shared/**/*.ts"]
}
```

- [ ] **Step 4: Каркас застосунку**

Створити `crm/src/env.ts`:

```ts
/**
 * Привʼязки Worker. Окремим файлом, а не в index.ts: цей тип потрібен
 * і модулям, які index імпортує (наприклад sync.ts), а імпорт типу з
 * index створив би коло.
 */
export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /* Запасний адресат, якщо в заявці не збереглося chat_id. Знак
     питання навмисно — забута змінна не має валити застосунок */
  TELEGRAM_CHAT_ID?: string;
  SESSION_SECRET: string;
}
```

Створити `crm/src/index.ts`:

```ts
/**
 * CRM: заявки і клієнти.
 *
 * Окремий Worker, а не частина сайту: сайт — статика з бюджетом
 * швидкості й навмисним предохранителем, який валить продакшн-збірку на
 * тимчасових даних, а CRM — застосунок, якому цей предохранитель не має
 * заважати розгортатися. База в них спільна.
 */
import { Hono } from 'hono';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

// Перевірка живості: не вимагає ні бази, ні входу
app.get('/health', (c) => c.text('ok'));

export default app;
```

- [ ] **Step 5: Не пускати зайве в git**

У `.gitignore` додати:

```
# CRM: залежності, локальний конфіг і сховище воркера
crm/node_modules
crm/wrangler.local.toml
crm/.wrangler
```

- [ ] **Step 6: Зручні скрипти з кореня**

У кореневий `package.json`, розділ `scripts`, додати:

```json
"crm:dev": "npm --prefix crm run dev",
"crm:check": "npm --prefix crm run check",
"crm:deploy": "npm --prefix crm run deploy",
```

- [ ] **Step 7: Поставити залежності й перевірити типи**

```bash
cd crm && cp wrangler.local.toml.example wrangler.local.toml && npm install && cd ..
npm run crm:check
```

Expected: встановлення без помилок; перевірка типів завершується кодом 0.

- [ ] **Step 8: Переконатися, що Worker піднімається**

```bash
npm run crm:dev
```

В іншому вікні:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8789/health
```

Expected: `200`.

- [ ] **Step 9: Переконатися, що сайт не зачеплено**

```bash
npm run validate >/dev/null 2>&1; echo "validate: $?"
npm run build >/dev/null 2>&1; echo "build (має бути 1): $?"
npm run build:preview >/dev/null 2>&1; echo "preview: $?"
```

Expected: `validate: 0`, `build (має бути 1): 1`, `preview: 0`.

- [ ] **Step 10: Коміт**

```bash
git add crm/package.json crm/package-lock.json crm/wrangler.toml \
  crm/wrangler.local.toml.example crm/tsconfig.json \
  crm/src/env.ts crm/src/index.ts .gitignore package.json
git commit -m "Каркас Worker для CRM"
```

---

## Task 5: Вхід через Telegram

**Files:**
- Create: `crm/src/auth.ts`, `crm/src/views/layout.ts`, `crm/src/views/login.ts`
- Modify: `crm/src/index.ts`

**Interfaces:**
- Consumes: `Env` (Task 4)
- Produces:
  - `verifyTelegramLogin(params: Record<string, string>, botToken: string): Promise<boolean>`
  - `signSession(tgId: string, secret: string, ttlSeconds?: number): Promise<string>`
  - `readSession(cookie: string | undefined, secret: string): Promise<string | null>`
  - `type Viewer = { tg_id: string; name: string; role: string }`
  - середина `requireAuth`, яка кладе `Viewer` у `c.set('viewer', …)`
  - `layout(title: string, body: HtmlEscapedString, viewer?: Viewer)`

- [ ] **Step 1: Написати перевірку підпису й сесію**

Створити `crm/src/auth.ts`:

```ts
/**
 * Вхід через Telegram: жодних паролів.
 *
 * Telegram Login Widget віддає дані користувача й підпис. Перевіряємо
 * HMAC-SHA256, де ключ — SHA-256 від токена бота: це доводить, що дані
 * справді від Telegram, а не підставлені в адресний рядок.
 *
 * Сесія — підписана кука без сховища. Відкликання доступу працює не
 * через строк куки, а через прапорець active у таблиці users: він
 * перевіряється на кожному запиті, бо в базу ми однаково ходимо.
 */
const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(keyData: ArrayBuffer | Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyData as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Порівняння, що не завершується на першій розбіжності */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Скільки живе підпис Telegram. Доба — рекомендація самого Telegram */
const LOGIN_MAX_AGE = 86400;

export async function verifyTelegramLogin(
  params: Record<string, string>,
  botToken: string
): Promise<boolean> {
  const given = params.hash;
  if (!given) return false;

  // Рядок перевірки: усі поля, крім hash, за абеткою, через перенос
  const check = Object.keys(params)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');

  const secret = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  if (!sameSecret(await hmac(secret, check), given)) return false;

  // Старий підпис — відмова: інакше перехоплена адреса працювала б вічно
  const authDate = Number(params.auth_date ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > LOGIN_MAX_AGE) return false;

  return true;
}

const SESSION_TTL = 60 * 60 * 24 * 30;

export async function signSession(
  tgId: string,
  secret: string,
  ttlSeconds = SESSION_TTL
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const value = `${tgId}.${exp}`;
  return `${value}.${await hmac(enc.encode(secret), value)}`;
}

export async function readSession(
  cookie: string | undefined,
  secret: string
): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;

  const [tgId, exp, sig] = parts;
  const value = `${tgId}.${exp}`;
  if (!sameSecret(await hmac(enc.encode(secret), value), sig)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;

  return tgId;
}
```

- [ ] **Step 2: Каркас сторінки**

Створити `crm/src/views/layout.ts`:

```ts
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type Viewer = { tg_id: string; name: string; role: string };

/* Стилі свої, а не з сайту: CRM — окремий застосунок, і бюджет
   швидкості сайту на неї не поширюється. Тримаємо мінімум. */
const STYLE = `
  :root { color-scheme: light dark; --line: #d8dbe0; --muted: #6b7280; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  header { display: flex; gap: 1rem; align-items: center;
           padding: .75rem 1rem; border-bottom: 1px solid var(--line); }
  header a { text-decoration: none; }
  main { padding: 1rem; max-width: 60rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid var(--line); }
  .muted { color: var(--muted); }
  form.inline { display: inline; }
  input, select, textarea, button { font: inherit; padding: .4rem; }
  label { display: block; margin: .6rem 0; }
`;

/* Тип тіла — саме той, що повертає тег `html` Hono: за наявності
   асинхронних вставок він віддає проміс, і вужчий тип змусив би
   приводити кожен виклик */
type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

export function layout(title: string, body: Body, viewer?: Viewer) {
  return html`<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${title} — CRM Avtoskloua</title>
    <style>${raw(STYLE)}</style>
  </head>
  <body>
    ${viewer
      ? html`<header>
          <a href="/">Заявки</a>
          <a href="/today">Сьогодні</a>
          <span class="muted">${viewer.name}</span>
          <form method="post" action="/logout" class="inline">
            <button type="submit">Вийти</button>
          </form>
        </header>`
      : ''}
    <main>${body}</main>
  </body>
</html>`;
}
```

- [ ] **Step 3: Сторінка входу**

Створити `crm/src/views/login.ts`:

```ts
import { html, raw } from 'hono/html';
import { layout } from './layout';

/**
 * Віджет Telegram вимагає, щоб домен був привʼязаний до бота через
 * /setdomain у BotFather. Поки бойового домену немає, підходить адреса
 * *.workers.dev — її теж треба привʼязати.
 */
export function loginPage(botName: string, error?: string) {
  return layout(
    'Вхід',
    html`<h1>CRM Avtoskloua</h1>
      ${error ? html`<p><strong>${error}</strong></p>` : ''}
      <p class="muted">Вхід лише для власника й майстрів.</p>
      ${raw(`<script async src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login="${botName}"
        data-size="large"
        data-auth-url="/auth"
        data-request-access="write"></script>`)}`
  );
}
```

- [ ] **Step 4: Підключити маршрути входу**

У `crm/src/index.ts` після оголошення `app` додати імпорти й маршрути:

```ts
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { readSession, signSession, verifyTelegramLogin } from './auth';
import { loginPage } from './views/login';
import type { Viewer } from './views/layout';

const COOKIE = 'crm_session';

/** Імʼя бота для віджета. Значення видиме в HTML — це не секрет */
const BOT_NAME = 'avtosklouabot';

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
```

Оголошення застосунку змінити, щоб `c.set('viewer', …)` мав тип:

```ts
const app = new Hono<{ Bindings: Env; Variables: { viewer: Viewer } }>();
```

- [ ] **Step 5: Перевірити типи**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 6: Перевірити, що підробку не пускає**

Скрипт рахує справжній підпис із токена (читає `.dev.vars` сам, нічого
не друкує) і підроблений — і порівнює відповіді.

Створити `auth-probe.mjs` **у корені репозиторію** (і видалити після
перевірки). Саме в корені, а не в `/tmp`: `readDevVars` читає `.dev.vars`
відносно поточної теки, а ESM-імпорт за абсолютним шляхом на Windows
падає з `ERR_UNSUPPORTED_ESM_URL_SCHEME` — відносний шлях обходить
обидві пастки.

```js
import { createHash, createHmac } from 'node:crypto';
import { readDevVars } from './scripts/_dev-vars.mjs';

const env = readDevVars(() => ({}));
const token = env.TELEGRAM_BOT_TOKEN;
const owner = env.OWNER_TG_ID;

const data = {
  id: owner,
  first_name: 'Власник',
  auth_date: String(Math.floor(Date.now() / 1000)),
};

const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join(String.fromCharCode(10));
const secret = createHash('sha256').update(token).digest();
const good = createHmac('sha256', secret).update(check).digest('hex');

const url = (hash) =>
  `http://127.0.0.1:8789/auth?${new URLSearchParams({ ...data, hash }).toString()}`;

for (const [label, hash] of [['справжній', good], ['підроблений', 'f'.repeat(64)]]) {
  const r = await fetch(url(hash), { redirect: 'manual' });
  console.log(`${label}: HTTP ${r.status}`);
}
```

Run: `node auth-probe.mjs`
Expected: `справжній: HTTP 302` (переадресація на `/`), `підроблений: HTTP 403`.

Пробу не комітити. Після Task 6, де вона ще знадобиться для куки, видалити:
`rm auth-probe.mjs`

- [ ] **Step 7: Перевірити, що знятий доступ діє негайно**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "UPDATE users SET active = 0"
node auth-probe.mjs
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "UPDATE users SET active = 1"
```

Expected: `справжній: HTTP 403` — підпис вірний, але доступу немає.
Після повернення `active = 1` перевірка зі Step 6 знову дає 302.

- [ ] **Step 8: Коміт**

```bash
git add crm/src/auth.ts crm/src/views/layout.ts crm/src/views/login.ts crm/src/index.ts
git commit -m "Вхід у CRM через Telegram"
```

---

## Task 6: Список заявок, пошук і фільтри

**Files:**
- Create: `crm/src/db.ts`, `crm/src/format.ts`, `crm/src/views/leads.ts`
- Modify: `crm/src/index.ts`

**Interfaces:**
- Consumes: `Env`, `Viewer`
- Produces:
  - `type LeadFull = LeadRow & { chat_id, message_id, notes, appointment_at, closed_at, amount, work_note }`
  - `listLeads(db, filter): Promise<LeadFull[]>` де
    `filter = { q?: string; status?: string; from?: string; to?: string }`
  - `getLead(db, id): Promise<LeadFull | null>`,
    `historyByPhone(db, phone): Promise<LeadFull[]>`,
    `listDay(db, dayStart, dayEnd): Promise<LeadFull[]>`
  - `money(kop: number | null | undefined): string`, `toKop(input: string): number | null`,
    `dateTime(iso: string | null | undefined): string`,
    `fromLocalInput(value: string): string | null`, `statusLabel(s: string): string`

- [ ] **Step 1: Формати для показу**

Створити `crm/src/format.ts`:

```ts
import { kyivShort } from '../../shared/card';

/** Копійки в базі → «1 200 ₴» для людини. Єдине місце перетворення */
export function money(kop: number | null | undefined): string {
  if (kop === null || kop === undefined) return '';
  const uah = Math.round(kop / 100);
  return `${uah.toLocaleString('uk-UA')} ₴`;
}

/** Копійки з поля форми: «1200» або «1200,50» → 120000 */
export function toKop(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export const dateTime = (iso: string | null | undefined) => (iso ? kyivShort(iso) : '');

/** «2026-09-30T14:00» із поля datetime-local → ISO у UTC */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const STATUS_LABEL: Record<string, string> = {
  new: '🆕 Нова',
  in_work: '🔧 В роботі',
  done: '✅ Виконана',
  declined: '✖️ Відмова',
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
```

- [ ] **Step 2: Запити до бази**

Створити `crm/src/db.ts`:

```ts
import type { LeadRow } from '../../shared/card';

export type LeadFull = LeadRow & {
  chat_id: string | null;
  message_id: number | null;
  notes: string | null;
  appointment_at: string | null;
  closed_at: string | null;
  amount: number | null;
  work_note: string | null;
};

export const LEAD_COLUMNS = `id, created_at, name, phone, age, car, photos, status,
  prev_status, actor_name, decline_reason, chat_id, message_id, notes,
  appointment_at, closed_at, amount, work_note`;

export type Filter = { q?: string; status?: string; from?: string; to?: string };

/**
 * Список заявок. Типово — активні: те, що вимагає дії сьогодні.
 *
 * Пошук іде по номеру й імені одночасно: оператор памʼятає або одне,
 * або друге, і змушувати його обирати поле — зайвий клік.
 */
export async function listLeads(db: D1Database, f: Filter): Promise<LeadFull[]> {
  const where: string[] = [];
  const bind: unknown[] = [];

  if (f.status && f.status !== 'all') {
    where.push('status = ?');
    bind.push(f.status);
  } else if (!f.status) {
    where.push("status IN ('new', 'in_work')");
  }

  if (f.q) {
    where.push('(phone LIKE ? OR name LIKE ?)');
    const like = `%${f.q}%`;
    bind.push(like, like);
  }

  if (f.from) {
    where.push('created_at >= ?');
    bind.push(f.from);
  }
  if (f.to) {
    where.push('created_at <= ?');
    bind.push(f.to);
  }

  const sql =
    `SELECT ${LEAD_COLUMNS} FROM leads` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY created_at DESC LIMIT 200';

  const res = await db.prepare(sql).bind(...bind).all<LeadFull>();
  return res.results ?? [];
}

export async function getLead(db: D1Database, id: number): Promise<LeadFull | null> {
  return db.prepare(`SELECT ${LEAD_COLUMNS} FROM leads WHERE id = ?`).bind(id).first<LeadFull>();
}

/** Усі звернення з того самого номера, найновіші зверху */
export async function historyByPhone(db: D1Database, phone: string): Promise<LeadFull[]> {
  const res = await db
    .prepare(`SELECT ${LEAD_COLUMNS} FROM leads WHERE phone = ? ORDER BY created_at DESC`)
    .bind(phone)
    .all<LeadFull>();
  return res.results ?? [];
}

/** Записані на добу від `dayStart` (ISO) — список на день */
export async function listDay(db: D1Database, dayStart: string, dayEnd: string) {
  const res = await db
    .prepare(
      `SELECT ${LEAD_COLUMNS} FROM leads
        WHERE appointment_at >= ? AND appointment_at < ?
        ORDER BY appointment_at`
    )
    .bind(dayStart, dayEnd)
    .all<LeadFull>();
  return res.results ?? [];
}
```

- [ ] **Step 3: Сторінка списку**

Створити `crm/src/views/leads.ts`:

```ts
import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, statusLabel } from '../format';

export type ListFilter = { q: string; status: string; from: string; to: string };

export function leadsPage(rows: LeadFull[], filter: ListFilter, viewer: Viewer) {
  return layout(
    'Заявки',
    html`<h1>Заявки</h1>

      <form method="get" action="/">
        <input type="search" name="q" value="${filter.q}" placeholder="Номер або імʼя" />
        <select name="status">
          <option value="" ${filter.status === '' ? 'selected' : ''}>Активні</option>
          <option value="new" ${filter.status === 'new' ? 'selected' : ''}>Нові</option>
          <option value="in_work" ${filter.status === 'in_work' ? 'selected' : ''}>В роботі</option>
          <option value="done" ${filter.status === 'done' ? 'selected' : ''}>Виконані</option>
          <option value="declined" ${filter.status === 'declined' ? 'selected' : ''}>Відмови</option>
          <option value="all" ${filter.status === 'all' ? 'selected' : ''}>Усі</option>
        </select>
        <input type="date" name="from" value="${filter.from}" aria-label="Від дати" />
        <input type="date" name="to" value="${filter.to}" aria-label="До дати" />
        <button type="submit">Шукати</button>
      </form>

      ${rows.length === 0
        ? html`<p class="muted">Нічого не знайдено.</p>`
        : html`<table>
            <thead>
              <tr><th>#</th><th>Клієнт</th><th>Стан</th><th>Запис</th><th>Авто</th></tr>
            </thead>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td><a href="/lead/${r.id}">${r.id}</a></td>
                  <td>
                    ${r.name}<br />
                    <a class="muted" href="/client/${encodeURIComponent(r.phone)}">${r.phone}</a>
                  </td>
                  <td>${statusLabel(r.status)}</td>
                  <td>${dateTime(r.appointment_at)}</td>
                  <td>${r.car ?? ''}</td>
                </tr>`
              )}
            </tbody>
          </table>`}`,
    viewer
  );
}
```

- [ ] **Step 4: Підключити маршрут**

У `crm/src/index.ts` додати:

```ts
import { listLeads } from './db';
import { leadsPage } from './views/leads';

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
```

- [ ] **Step 5: Перевірити типи**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 6: Покласти в базу три заявки для перевірки**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml --command "
INSERT INTO leads (created_at, name, phone, car, photos, status) VALUES
 ('2026-09-01T08:00:00.000Z', 'ТЕСТ Петро', '+380670000001', 'Skoda', 0, 'new'),
 ('2026-09-02T08:00:00.000Z', 'ТЕСТ Ганна', '+380670000002', 'Mazda', 0, 'in_work'),
 ('2026-09-03T08:00:00.000Z', 'ТЕСТ Петро', '+380670000001', 'Skoda', 0, 'done')"
```

- [ ] **Step 7: Перевірити список, пошук і фільтр**

Сесію взяти з браузера або зібрати кукою; простіше — тимчасово перевірити
через `curl` із кукою, яку видає `/auth` у пробі з Task 5. Щоб не
вигадувати, додати до `auth-probe.mjs` збереження куки:

```js
const r = await fetch(url(good), { redirect: 'manual' });
console.log('cookie:', r.headers.get('set-cookie')?.split(';')[0]);
```

Далі, підставивши куку:

```bash
COOKIE='crm_session=...'
curl -s -H "Cookie: $COOKIE" 'http://127.0.0.1:8789/' | grep -c "ТЕСТ"
curl -s -H "Cookie: $COOKIE" 'http://127.0.0.1:8789/?q=0000002' | grep -c "ТЕСТ Ганна"
curl -s -H "Cookie: $COOKIE" 'http://127.0.0.1:8789/?status=done' | grep -c "ТЕСТ Петро"
curl -s -H "Cookie: $COOKIE" 'http://127.0.0.1:8789/?status=all&from=2026-09-02&to=2026-09-02' \
  | grep -c "ТЕСТ Ганна"
curl -s -o /dev/null -w "без куки: %{http_code}\n" 'http://127.0.0.1:8789/'
```

Expected: перший — `2` (типово лише активні: `new` і `in_work`); другий —
`1`; третій — `1`; четвертий — `1` (за добу 2 вересня є рівно одна
заявка, і вона потрапляє у вибірку попри те, що створена о 08:00, а не
опівночі — саме це доводить, що «до» рахується включно); останній —
`302` (переадресація на вхід).

- [ ] **Step 8: Коміт**

```bash
git add crm/src/db.ts crm/src/format.ts crm/src/views/leads.ts crm/src/index.ts
git commit -m "Список заявок із пошуком і фільтрами"
```

---

## Task 7: Картка заявки, дії та синхронізація з ботом

**Files:**
- Create: `crm/src/views/lead.ts`, `crm/src/sync.ts`
- Modify: `crm/src/index.ts`, `crm/src/db.ts`

**Interfaces:**
- Consumes: `LeadFull`, `getLead`, `historyByPhone`, `drawCard`, `REASONS`, `clean`
- Produces:
  - `applyChange(db, id, patch): Promise<LeadFull | null>` — один шлях для
    всіх змін стану, з ідемпотентністю
  - `syncCard(env, db, id): Promise<void>`

- [ ] **Step 1: Один шлях для змін стану**

Додати в `crm/src/db.ts`:

```ts
import type { Status } from '../../shared/card';

export type Patch = {
  status?: Status;
  appointment_at?: string | null;
  closed_at?: string | null;
  amount?: number | null;
  work_note?: string | null;
  decline_reason?: string | null;
  actor_id?: string;
  actor_name?: string;
};

/**
 * Єдиний шлях зміни заявки.
 *
 * Зміна стану веде себе так само, як у боті: `AND status <> ?` тримає
 * інваріант prev_status <> status, тож «Повернути» завжди має куди
 * вести. Повторна та сама зміна нічого не переписує.
 *
 * decline_reason скидається на кожній зміні стану: у свіжій відмові
 * причини ще немає, при поверненні вона стає неправдою, а при повторній
 * відмові лишилася б стара.
 */
export async function applyChange(
  db: D1Database,
  id: number,
  patch: Patch
): Promise<LeadFull | null> {
  const sets: string[] = [];
  const bind: unknown[] = [];
  const where: string[] = ['id = ?'];

  /* Порядок важливий. Зміна стану скидає причину відмови, але якщо
     причину передали в цьому ж патчі — скидати нічого не треба, інакше
     в UPDATE опинилося б два присвоєння одній колонці. */
  const hasReason = patch.decline_reason !== undefined;

  if (patch.status) {
    sets.push('prev_status = status', 'status = ?');
    bind.push(patch.status);
    if (!hasReason) sets.push('decline_reason = NULL');
  }

  for (const field of ['appointment_at', 'closed_at', 'amount', 'work_note', 'decline_reason'] as const) {
    if (patch[field] !== undefined) {
      sets.push(`${field} = ?`);
      bind.push(patch[field]);
    }
  }

  if (patch.actor_id !== undefined) {
    sets.push('actor_id = ?', 'actor_name = ?');
    bind.push(patch.actor_id, patch.actor_name ?? null);
  }

  sets.push('updated_at = ?');
  bind.push(new Date().toISOString());

  bind.push(id);
  if (patch.status) {
    where.push('status <> ?');
    bind.push(patch.status);
  }

  await db
    .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE ${where.join(' AND ')}`)
    .bind(...bind)
    .run();

  return getLead(db, id);
}
```

- [ ] **Step 2: Синхронізація з ботом**

Створити `crm/src/sync.ts`:

```ts
/**
 * Після будь-якої зміни стану картка в Telegram перемальовується —
 * інакше в чаті лишиться вчорашня правда, а в групі її бачить уся
 * команда.
 *
 * Помилка тут не валить дію: заявка в базі вже змінена, і втратити
 * зміну через недоступний Telegram гірше, ніж мати непереmalьовану
 * картку.
 */
import { drawCard, telegramApi, type NotifyRow } from '../../shared/notify';
import type { Env } from './env';
import { getLead } from './db';

export async function syncCard(env: Env, id: number): Promise<void> {
  try {
    const row = await getLead(env.DB, id);
    if (!row) return;
    await drawCard(env.DB, telegramApi(env.TELEGRAM_BOT_TOKEN), env.TELEGRAM_CHAT_ID, row as NotifyRow);
  } catch {
    // Мовчки: стан у базі важливіший за картку в чаті
  }
}
```

- [ ] **Step 3: Сторінка картки заявки**

Створити `crm/src/views/lead.ts`:

```ts
import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';
import { REASONS } from '../../../shared/card';

export function leadPage(lead: LeadFull, history: LeadFull[], viewer: Viewer) {
  const notes = (lead.notes ?? '').split('\n').filter((n) => n.trim());

  return layout(
    `Заявка #${lead.id}`,
    html`<h1>Заявка #${lead.id} · ${statusLabel(lead.status)}</h1>

      <p>
        <strong>${lead.name}</strong><br />
        <a href="/client/${encodeURIComponent(lead.phone)}">${lead.phone}</a><br />
        <span class="muted">${[lead.age, lead.car].filter(Boolean).join(' · ')}</span>
      </p>

      <p class="muted">Прийшла: ${dateTime(lead.created_at)}${
        lead.actor_name ? html` · взяв: ${lead.actor_name}` : ''
      }</p>

      ${notes.map((n) => html`<p><strong>${n}</strong></p>`)}
      ${lead.decline_reason ? html`<p>Причина відмови: ${lead.decline_reason}</p>` : ''}
      ${lead.closed_at
        ? html`<p>Закрито ${dateTime(lead.closed_at)} на ${money(lead.amount)}.
            ${lead.work_note ?? ''}</p>`
        : ''}

      <h2>Запис на час</h2>
      <form method="post" action="/lead/${lead.id}/appoint">
        <input type="datetime-local" name="appointment_at" />
        <button type="submit">Записати</button>
      </form>

      <h2>Закрити роботу</h2>
      <form method="post" action="/lead/${lead.id}/close">
        <label>Сума, ₴ <input name="amount" inputmode="decimal" required /></label>
        <label>Що зробили <textarea name="work_note" rows="2"></textarea></label>
        <button type="submit">Виконано</button>
      </form>

      <h2>Відмова</h2>
      <form method="post" action="/lead/${lead.id}/decline">
        <select name="reason">
          ${REASONS.map((r) => html`<option value="${r}">${r}</option>`)}
          <option value="">Інша причина</option>
        </select>
        <input name="other" placeholder="Своя причина" />
        <button type="submit">Відмовити</button>
      </form>

      <form method="post" action="/lead/${lead.id}/undo">
        <button type="submit">↩️ Повернути</button>
      </form>

      <h2>Звернення з цього номера</h2>
      <table>
        <tbody>
          ${history.map(
            (h) => html`<tr>
              <td><a href="/lead/${h.id}">#${h.id}</a></td>
              <td>${dateTime(h.created_at)}</td>
              <td>${statusLabel(h.status)}</td>
              <td>${money(h.amount)}</td>
            </tr>`
          )}
        </tbody>
      </table>`,
    viewer
  );
}
```

- [ ] **Step 4: Маршрути дій**

У `crm/src/index.ts` додати:

```ts
import { applyChange, getLead, historyByPhone } from './db';
import { leadPage } from './views/lead';
import { syncCard } from './sync';
import { clean, type Status } from '../../shared/card';
import { fromLocalInput, toKop } from './format';

app.get('/lead/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const lead = await getLead(c.env.DB, id);
  if (!lead) return c.notFound();
  const history = await historyByPhone(c.env.DB, lead.phone);
  return c.html(leadPage(lead, history, c.get('viewer')));
});

app.post('/lead/:id/appoint', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.formData();
  const at = fromLocalInput(String(form.get('appointment_at') ?? ''));

  const viewer = c.get('viewer');
  const lead = await getLead(c.env.DB, id);
  if (!lead) return c.notFound();

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
  const id = Number(c.req.param('id'));
  const form = await c.req.formData();
  const viewer = c.get('viewer');

  await applyChange(c.env.DB, id, {
    status: 'done',
    closed_at: new Date().toISOString(),
    amount: toKop(String(form.get('amount') ?? '')),
    work_note: clean(form.get('work_note'), 400) || null,
    actor_id: viewer.tg_id,
    actor_name: viewer.name,
  });

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});

app.post('/lead/:id/decline', async (c) => {
  const id = Number(c.req.param('id'));
  const form = await c.req.formData();
  const viewer = c.get('viewer');

  const picked = String(form.get('reason') ?? '');
  const other = clean(form.get('other'), 200);
  const reason = picked || other || null;

  await applyChange(c.env.DB, id, {
    status: 'declined',
    actor_id: viewer.tg_id,
    actor_name: viewer.name,
    decline_reason: reason,
  });

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});

app.post('/lead/:id/undo', async (c) => {
  const id = Number(c.req.param('id'));
  const lead = await getLead(c.env.DB, id);
  if (!lead) return c.notFound();

  const viewer = c.get('viewer');
  await applyChange(c.env.DB, id, {
    status: (lead.prev_status ?? 'new') as Status,
    actor_id: viewer.tg_id,
    actor_name: viewer.name,
  });

  await syncCard(c.env, id);
  return c.redirect(`/lead/${id}`);
});
```

- [ ] **Step 5: Перевірити типи**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 6: Перевірити дії проти бази**

Узяти id заявки «ТЕСТ Ганна» з Task 6 і, підставивши куку:

```bash
ID=$(npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "SELECT id FROM leads WHERE name = 'ТЕСТ Ганна'" --json | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)[0].results[0].id))")

curl -s -o /dev/null -X POST -H "Cookie: $COOKIE" \
  -d "amount=1200&work_note=Ремонт скола" "http://127.0.0.1:8789/lead/$ID/close"

npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "SELECT status, amount, work_note, closed_at FROM leads WHERE id = $ID"
```

Expected: `status: done`, `amount: 120000` (копійки!), `work_note` і
`closed_at` заповнені.

Далі повернення:

```bash
curl -s -o /dev/null -X POST -H "Cookie: $COOKIE" "http://127.0.0.1:8789/lead/$ID/undo"
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "SELECT status, prev_status, decline_reason FROM leads WHERE id = $ID"
```

Expected: `status: in_work`, `prev_status: done`, `decline_reason: null`.

- [ ] **Step 7: Перевірити синхронізацію з ботом наскрізь**

Потрібен живий бот: підняти сайт і тунель як у Task 2, надіслати **одну**
заявку з іменем на `ТЕСТ`, відкрити її в CRM і закрити з сумою.

Expected: картка в групі перемальовується на «✅ Виконана» **на місці**,
дублікат не зʼявляється. У звіті назвати кількість надісланих
повідомлень.

- [ ] **Step 8: Коміт**

```bash
git add crm/src/views/lead.ts crm/src/sync.ts crm/src/db.ts crm/src/index.ts
git commit -m "Картка заявки: запис, закриття, відмова, синхронізація з ботом"
```

---

## Task 8: Картка клієнта і список на сьогодні

**Files:**
- Create: `crm/src/views/client.ts`, `crm/src/views/today.ts`
- Modify: `crm/src/index.ts`

**Interfaces:**
- Consumes: `historyByPhone`, `listDay`, `money`, `dateTime`

- [ ] **Step 1: Картка клієнта**

Створити `crm/src/views/client.ts`:

```ts
import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';

/**
 * Клієнт — це представлення за номером телефона, а не окрема таблиця.
 * Сутність зʼявиться, коли буде що зберігати понад заявки.
 */
export function clientPage(phone: string, rows: LeadFull[], viewer: Viewer) {
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const cars = [...new Set(rows.map((r) => r.car).filter(Boolean))];
  const name = rows[0]?.name ?? '';

  return layout(
    phone,
    html`<h1>${name}</h1>
      <p><a href="tel:${phone}">${phone}</a></p>
      <p class="muted">
        Звернень: ${rows.length}${cars.length ? html` · ${cars.join(', ')}` : ''}${
          total ? html` · разом ${money(total)}` : ''
        }
      </p>

      <table>
        <thead>
          <tr><th>#</th><th>Коли</th><th>Стан</th><th>Сума</th><th>Робота</th></tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) => html`<tr>
              <td><a href="/lead/${r.id}">#${r.id}</a></td>
              <td>${dateTime(r.created_at)}</td>
              <td>${statusLabel(r.status)}</td>
              <td>${money(r.amount)}</td>
              <td>${r.work_note ?? r.decline_reason ?? ''}</td>
            </tr>`
          )}
        </tbody>
      </table>`,
    viewer
  );
}
```

- [ ] **Step 2: Список на сьогодні**

Створити `crm/src/views/today.ts`:

```ts
import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, statusLabel } from '../format';

export function todayPage(rows: LeadFull[], viewer: Viewer) {
  return layout(
    'Сьогодні',
    html`<h1>Сьогодні</h1>
      ${rows.length === 0
        ? html`<p class="muted">На сьогодні нікого не записано.</p>`
        : html`<table>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td>${dateTime(r.appointment_at)}</td>
                  <td><a href="/lead/${r.id}">#${r.id}</a> ${r.name}</td>
                  <td>${r.phone}</td>
                  <td>${r.car ?? ''}</td>
                  <td>${statusLabel(r.status)}</td>
                </tr>`
              )}
            </tbody>
          </table>`}`,
    viewer
  );
}
```

- [ ] **Step 3: Маршрути**

У `crm/src/index.ts` додати:

```ts
import { listDay } from './db';
import { clientPage } from './views/client';
import { todayPage } from './views/today';

app.get('/client/:phone', async (c) => {
  const phone = decodeURIComponent(c.req.param('phone'));
  const rows = await historyByPhone(c.env.DB, phone);
  if (rows.length === 0) return c.notFound();
  return c.html(clientPage(phone, rows, c.get('viewer')));
});

app.get('/today', async (c) => {
  /* Межі доби рахуємо за київським часом, а в базі час у UTC. Різниця
     значуща саме на межах: запис на 01:00 за Києвом — це ще вчорашній
     день за UTC, і без перерахунку він зник би зі списку. */
  const now = new Date();
  const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
  const offset = now.getTime() - kyiv.getTime();

  const start = new Date(kyiv.getFullYear(), kyiv.getMonth(), kyiv.getDate());
  const from = new Date(start.getTime() + offset).toISOString();
  const to = new Date(start.getTime() + offset + 24 * 3600 * 1000).toISOString();

  const rows = await listDay(c.env.DB, from, to);
  return c.html(todayPage(rows, c.get('viewer')));
});
```

- [ ] **Step 4: Перевірити типи**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 5: Перевірити картку клієнта**

У базі з Task 6 номер `+380670000001` має два звернення.

```bash
curl -s -H "Cookie: $COOKIE" 'http://127.0.0.1:8789/client/%2B380670000001' | grep -c "Звернень: 2"
```

Expected: `1`.

- [ ] **Step 6: Перевірити список на сьогодні, включно з межею доби**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml --command "
UPDATE leads SET appointment_at = strftime('%Y-%m-%dT%H:%M:00.000Z', 'now') WHERE name = 'ТЕСТ Петро'"

curl -s -H "Cookie: $COOKIE" 'http://127.0.0.1:8789/today' | grep -c "ТЕСТ Петро"
```

Expected: число більше за нуль.

Окремо перевірити межу: поставити запис на 00:30 за київським часом
сьогодні й переконатися, що він у списку, а вчорашній о 23:30 — ні.

- [ ] **Step 7: Прибрати тестові рядки**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "DELETE FROM leads WHERE name LIKE 'ТЕСТ%'; SELECT COUNT(*) AS n FROM leads"
```

Expected: `n: 0`.

- [ ] **Step 8: Коміт**

```bash
git add crm/src/views/client.ts crm/src/views/today.ts crm/src/index.ts
git commit -m "Картка клієнта і список на сьогодні"
```

---

## Task 9: README і приймання

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Описати CRM у README**

Додати розділ `## CRM` після розділу про Telegram-бота. Він мусить
містити:

- навіщо окремий Worker, а не сторінки сайту: у сайту бюджет швидкості й
  предохранитель на тимчасових даних, у CRM — свої залежності й свій
  деплой; Pages не має Cron Triggers, які знадобляться для нагадувань;
- **одна тека міграцій на спільну базу** і чому дві зламали б схему;
- локальний запуск: `cp crm/wrangler.local.toml.example crm/wrangler.local.toml`,
  `npm --prefix crm install`, `npm run crm:dev` (порт 8789), і що
  `--persist-to ../.wrangler/state` тримає ту саму локальну базу, що й сайт;
- змінні: `SESSION_SECRET`, `OWNER_TG_ID`, і що токен та `TELEGRAM_CHAT_ID`
  спільні з сайтом;
- `npm run crm:seed-owner` — навіщо і що без нього зайти неможливо;
- **привʼязка домену до бота через `/setdomain` у BotFather** — без неї
  віджет входу не працює; поки бойового домену немає, підходить
  `*.workers.dev`;
- деплой: `npx wrangler d1 create leads`, підставити `database_id` у
  `crm/wrangler.toml`, `npm run crm:deploy`, потім
  `npm run crm:seed-owner -- --remote`;
- **порядок: спершу міграція, потім код** — CRM читає колонки, яких до
  `0004` немає.

- [ ] **Step 2: Перевірити, що шляхи з README існують**

Run: `npm run validate`
Expected: код 0, і серед попереджень немає рядків «посилається на … —
такого файлу в проєкті немає».

- [ ] **Step 3: Приймання — сайт не зламано**

```bash
npm run validate >/dev/null 2>&1; echo "validate: $?"
npm run check:functions >/dev/null 2>&1; echo "типи функцій: $?"
npm run build >/dev/null 2>&1; echo "build (має бути 1): $?"
npm run build:preview >/dev/null 2>&1; echo "preview: $?"
npx lhci autorun >/dev/null 2>&1; echo "lighthouse: $?"
```

Expected: `0`, `0`, `1`, `0`, `0`.

- [ ] **Step 4: Приймання — CRM наскрізь**

Підняти сайт, тунель, вебхук і CRM. Надіслати **одну** заявку з іменем
на `ТЕСТ`. Далі в браузері: увійти через Telegram, знайти заявку в
списку, відкрити, записати на час, закрити з сумою.

Expected на кожному кроці: заявка видно в списку; після запису вона
переходить у «В роботі»; після закриття — «Виконана» із сумою; **картка
в групі перемальовується на місці**, дублікатів немає; у картці клієнта
видно це звернення із сумою.

- [ ] **Step 5: Прибрати тестові дані**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "DELETE FROM leads WHERE name LIKE 'ТЕСТ%'; SELECT COUNT(*) AS n FROM leads"
```

Expected: `n: 0`.

- [ ] **Step 6: Коміт**

```bash
git add README.md
git commit -m "README: CRM — запуск, змінні, деплой"
```

---

## Що лишається поза цим планом

Другий кусок: майстри й призначення заявок, розділення прав за роллю.
Третій: календар на тиждень. Четвертий: гроші та звіти поверх
накопиченого. Пʼятий: нагадування й запит відгуку після роботи — для них
знадобиться Cron Trigger, якого Pages не має і заради якого CRM зроблено
окремим Worker.

Перевірка «кнопку натиснув свій» у боті теж лишається на другий кусок:
таблиця `users` цього плану стане списком дозволених, і `actor_id` із
`callback_query` треба буде звіряти з нею.
