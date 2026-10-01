# CRM, другий кусок: майстри й призначення — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Майстри заводяться самі при першому натисканні кнопки в групі,
у заявки зʼявляється виконавець, і власник може перевішувати її на
іншого майстра.

**Architecture:** Доступ до кнопок бота перевіряється спільним модулем
`shared/users.ts`, який заодно заводить невідомого натискача майстром і
**не воскрешає** того, кому доступ зняли. Виконавець (`assignee`)
зберігається поряд із тим, хто натиснув (`actor`), бо це різні питання:
«чия це робота» і «хто останній змінив стан». Вхід у CRM звужується до
ролі `owner`.

**Tech Stack:** Cloudflare Workers і Pages Functions, Hono, D1 (SQLite),
TypeScript, Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-10-01-crm-masters-design.md`

## Global Constraints

- Видимий текст і коментарі — українською, UTF-8. Стани заявки й ролі в
  базі — латиницею (`new`, `in_work`, `done`, `declined`; `owner`,
  `master`).
- **Сайт не ламати.** `npm run build` мусить і далі падати (зараз — на
  демонстраційних відгуках, це навмисний запобіжник);
  `npm run build:preview`, `npm run validate` і `npx lhci autorun`
  проходять.
- **Одна тека міграцій — коренева `migrations/`.** База спільна, і
  `wrangler d1 migrations` веде таблицю застосованого всередині неї.
- **Локальна база одна:** `.wrangler/state` у корені. `wrangler d1
  execute` вимагає `-c wrangler.local.toml --persist-to .wrangler/state`.
- **Кирилиця в `--command` у Git Bash псується** — запит мовчки не
  зачіпає жодного рядка. Робити через `--file`.
- **Не читати `.dev.vars`** і не друкувати його значень. У проєкті вже
  був випадок, коли субагент вставив токен у звіт і токен довелося
  відкликати.
- **Тестовий трафік долітає в робочу групу власника.** Імʼя в тестовій
  заявці починається з `ТЕСТ`, повідомлень якнайменше, кількість
  називається у звіті. Для перевірок бота без Telegram підіймати воркер
  зі сміттєвим токеном і `chat_id = '1'`.
- Дані від людини не мусять підробити рядок картки чи вставити розмітку
  в HTML: `clean()` для картки, теговані шаблони `hono/html` для
  сторінок, `raw()` лише для констант.
- Жодних нових залежностей.
- **Керуючі символи в перевірочних скриптах будувати через
  `String.fromCharCode()`**, не escape-послідовностями: у цьому проєкті
  `\uXXXX` уже чотири рази не переживав запису файлу.

---

## Структура файлів

**Створюються:**

| Файл | За що відповідає |
|---|---|
| `migrations/0006_assignee.sql` | `assignee_id`, `assignee_name` у `leads` і перенос наявних значень з `actor` |
| `shared/users.ts` | Хто має право діяти: пошук, автозаведення майстра, правило «знятий не воскресає» |
| `crm/src/views/users.ts` | Сторінка «Люди»: хто є, зняти й повернути доступ |

**Змінюються:**

| Файл | Що саме |
|---|---|
| `shared/card.ts` | `LeadRow` отримує `assignee_name`; рядок «Взяв:» показує виконавця |
| `functions/api/tg.ts` | Перевірка доступу й автозаведення; «В роботу» ставить виконавця |
| `crm/src/db.ts` | `LEAD_COLUMNS` і `LeadFull` із виконавцем; `listUsers`, `setUserActive`, `assignLead` |
| `crm/src/index.ts` | Вхід лише для `owner`; маршрути `/users` і `/lead/:id/assign` |
| `crm/src/views/lead.ts` | Виконавець і форма перевішування |
| `crm/src/views/leads.ts` | Імʼя виконавця в картці списку |
| `crm/src/views/layout.ts` | Пункт «Люди» в шапці |
| `README.md` | Розділ про майстрів і доступи |

---

## Task 1: Міграція та спільний модуль доступу

**Files:**
- Create: `migrations/0006_assignee.sql`, `shared/users.ts`
- Modify: `tsconfig.functions.json` не чіпати — `shared/**` уже охоплено

**Interfaces:**
- Produces:
  - колонки `leads.assignee_id TEXT`, `leads.assignee_name TEXT`
  - `shared/users.ts`:
    - `type UserRow = { tg_id: string; name: string; role: string; active: number }`
    - `findUser(db: D1Database, tgId: string): Promise<UserRow | null>`
    - `userForAction(db: D1Database, tgId: string, name: string): Promise<UserRow | null>`

- [ ] **Step 1: Написати міграцію**

Створити `migrations/0006_assignee.sql`:

```sql
-- Виконавець заявки — окремо від того, хто останній змінив стан.
--
-- Навіщо два поля, а не одне. `actor_id`/`actor_name` відповідають на
-- питання «хто натиснув»: коли власник перевішує заявку, натискає він,
-- а робити її буде інший. Злиті в одне поле, ці дві речі дали б
-- неправильними обидва майбутні звіти — і «скільки зробив кожен
-- майстер», і «хто що робив із заявкою».
--
-- Імʼя зберігається поряд із номером навмисно, так само як у
-- `actor_name`: картку малює бот, і тягнути заради одного рядка ще
-- один запит до `users` дорожче, ніж зберегти копію. Якщо майстер
-- змінить імʼя в Telegram, у старих заявках лишиться те, яке було на
-- момент роботи — для історії це радше добре. Звіти мусять групувати
-- за `assignee_id`, а не за іменем.
ALTER TABLE leads ADD COLUMN assignee_id TEXT;
ALTER TABLE leads ADD COLUMN assignee_name TEXT;

-- Перенос наявних рядків. Сьогодні кнопки натискає лише власник, тож
-- «хто натиснув» і «чия робота» в них збігаються — це не здогадка, а
-- точний перенос.
UPDATE leads
   SET assignee_id = actor_id, assignee_name = actor_name
 WHERE actor_id IS NOT NULL AND actor_id <> '';

-- Звіт «скільки зробив кожен майстер» питатиме саме це
CREATE INDEX IF NOT EXISTS idx_leads_assignee ON leads (assignee_id);
```

- [ ] **Step 2: Накотити локально**

```bash
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/state -c wrangler.local.toml
```

Expected: `0006_assignee.sql` зі статусом ✅.

- [ ] **Step 3: Переконатися, що колонки зʼявились**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "PRAGMA table_info(leads)" | grep -c "assignee_id\|assignee_name"
```

Expected: `2`.

- [ ] **Step 4: Написати спільний модуль доступу**

Створити `shared/users.ts`:

```ts
/**
 * Хто має право діяти із заявками.
 *
 * Спільний для бота (`functions/api/tg.ts`) і CRM: правило «знятий
 * доступ не воскресає» мусить бути одне на два інтерфейси, інакше одна
 * копія колись дозволить те, що друга забороняє.
 *
 * Тека починається не з підкреслення, але лежить поза `functions/`, і
 * Pages її збирає — це перевірено в попередньому куску.
 */
export type UserRow = {
  tg_id: string;
  name: string;
  /** owner | master */
  role: string;
  /** 0 — доступ знято */
  active: number;
};

export async function findUser(db: D1Database, tgId: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT tg_id, name, role, active FROM users WHERE tg_id = ?')
    .bind(tgId)
    .first<UserRow>();
}

/**
 * Користувач, який має право діяти — або null.
 *
 * Невідомого заводить майстром: людину вже додали в приватну групу, а
 * це й є рішення довіряти їй. Окреме підтвердження дублювало б те, що
 * власник ухвалив, коли запрошував.
 *
 * **Рядок із `active = 0` не воскресає.** Якщо доступ зняли, наступне
 * натискання отримує відмову, а не новий рядок: інакше «зняти доступ»
 * не означало б нічого, поки людина лишається в групі.
 *
 * `ON CONFLICT DO NOTHING` плюс повторне читання — проти гонки: два
 * одночасні натиски однієї людини не мусять дати ні помилки, ні двох
 * рядків.
 */
export async function userForAction(
  db: D1Database,
  tgId: string,
  name: string
): Promise<UserRow | null> {
  const found = await findUser(db, tgId);
  if (found) return found.active === 1 ? found : null;

  await db
    .prepare(
      `INSERT INTO users (tg_id, name, role, active, created_at)
       VALUES (?, ?, 'master', 1, ?)
       ON CONFLICT(tg_id) DO NOTHING`
    )
    .bind(tgId, name, new Date().toISOString())
    .run();

  return findUser(db, tgId);
}
```

- [ ] **Step 5: Переконатися, що типи сходяться**

Run: `npm run check:functions`
Expected: код повернення 0, без виводу помилок.

- [ ] **Step 6: Перевірити поведінку модуля проти живої бази**

Створити `users-probe.mjs` **у корені репозиторію** (відносний імпорт і
поточна тека — обидві важливі; після перевірки видалити):

```js
import { execFileSync } from 'node:child_process';

const sql = (q) => {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/state',
     '-c', 'wrangler.local.toml', '--json', '--command', q],
    { encoding: 'utf8', shell: true }
  );
  return JSON.parse(out)[0].results;
};

console.log('до:', JSON.stringify(sql('SELECT tg_id, role, active FROM users')));
```

Run: `node users-probe.mjs`
Expected: один рядок — власник, роль `owner`, `active` 1.

Сам модуль перевіряється в наступній задачі, через бота: окремого
запускача для `.ts` у проєкті немає, а заводити його заради однієї
функції — робота іншого розміру.

```bash
rm users-probe.mjs
```

- [ ] **Step 7: Коміт**

```bash
git add migrations/0006_assignee.sql shared/users.ts
git commit -m "Виконавець у заявці й спільний модуль доступу"
```

---

## Task 2: Бот пускає до кнопок лише своїх

**Files:**
- Modify: `functions/api/tg.ts`

**Interfaces:**
- Consumes: `userForAction` із `shared/users.ts` (Task 1)
- Produces: жодна дія бота не виконується для людини з `active = 0`;
  невідомий натискач заводиться майстром

- [ ] **Step 1: Підключити модуль**

У `functions/api/tg.ts` до наявних імпортів додати:

```ts
import { userForAction } from '../../shared/users';
```

- [ ] **Step 2: Поставити перевірку перед будь-якою дією**

У `onRequestPost`, одразу після рядка `const db = env.DB;` і **до**
`let changed = false;`, вставити:

```ts
  /* Хто натиснув. Імʼя беремо живе, з Telegram: воно свіжіше за копію
     в `users`, а в картку йде саме воно. Без clean() перенос рядка
     всередині імені дописав би в картку рядок, що виглядає як поле
     заявки. */
  const who = clean(cq.from?.first_name || cq.from?.username || 'невідомо', 80) || 'невідомо';
  const fromId = cq.from?.id ? String(cq.from.id) : '';

  if (!fromId) {
    await close('Не вдалося розпізнати, хто натиснув');
    return okEmpty();
  }

  /* Доступ. Невідомого заводимо майстром — людина вже в групі, а це й є
     рішення довіряти їй. Знятого не воскрешаємо.

     Відмова видима, а не мовчазна: мовчання людина прочитає як поломку
     бота й натисне ще кілька разів. */
  const user = await userForAction(db, fromId, who);
  if (!user) {
    await close('У вас немає доступу до заявок');
    return okEmpty();
  }
```

- [ ] **Step 3: Прибрати дублікат оголошення `who`**

Нижче в тому самому обробнику вже є рядок, який рахує `who` вдруге —
разом із коментарем про `clean()`. Видалити його: тепер значення
приходить згори. Сам `clean` лишається імпортованим — його використовує
вільна причина відмови.

- [ ] **Step 4: Переконатися, що типи сходяться**

Run: `npm run check:functions`
Expected: код 0.

- [ ] **Step 5: Переконатися, що бот збирається з новим спільним модулем**

```bash
npx wrangler pages functions build --outdir /tmp/fnb-users
grep -c "немає доступу" /tmp/fnb-users/index.js
```

Expected: `Compiled Worker successfully` і число більше за нуль.

- [ ] **Step 6: Перевірити три випадки проти живої бази**

Підняти сайт **зі сміттєвим токеном**, щоб жодне повідомлення не пішло
в групу: створити у скретчпаді власний файл змінних (скопіювати
`.dev.vars.example`, вписати вигаданий токен такої ж форми, вигаданий
секрет вебхука й `TELEGRAM_CHAT_ID=1`) і запустити

```bash
npm run build:preview
npx wrangler pages dev dist --port 8788 --kv RATE --d1 DB \
  --persist-to .wrangler/state --env-file <шлях-до-свого-файлу>
```

Завести рядок заявки й трьох людей:

```sql
-- через --file, не --command: кирилиця в --command у Git Bash псується
INSERT INTO leads (created_at, name, phone, photos, status, chat_id)
VALUES ('2026-10-01T09:00:00.000Z', 'ТЕСТ Доступ', '+380670000055', 0, 'new', '1');

INSERT INTO users (tg_id, name, role, active, created_at)
VALUES ('900000001', 'ТЕСТ Знятий', 'master', 0, '2026-10-01T09:00:00.000Z');
```

Далі надіслати на `/api/tg` три синтетичні натискання з власним
секретом вебхука (взяти зі свого файлу змінних):

| Хто | `from.id` | Очікується |
|---|---|---|
| Невідомий | `900000002` | HTTP 200, у `users` зʼявився рядок із роллю `master`, стан заявки змінився |
| Він же вдруге | `900000002` | HTTP 200, другого рядка немає |
| Знятий | `900000001` | HTTP 200, **стан заявки не змінився**, нового рядка немає |

Перевіряти саме стан рядка в базі, а не лише код відповіді: обробник
відповідає 200 завжди, крім чужого секрета.

- [ ] **Step 7: Прибрати за собою**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "DELETE FROM leads; DELETE FROM users WHERE tg_id LIKE '9000000%'"
```

Expected: у `users` лишається рівно один рядок — власник.

- [ ] **Step 8: Коміт**

```bash
git add functions/api/tg.ts
git commit -m "Кнопки бота — лише для своїх, невідомий стає майстром"
```

---

## Task 3: Виконавець у картці

**Files:**
- Modify: `shared/card.ts`, `functions/api/tg.ts`

**Interfaces:**
- Consumes: колонки з Task 1, `user` з Task 2
- Produces: `LeadRow.assignee_name`; картка показує виконавця; дія
  `work` записує виконавця

- [ ] **Step 1: Додати поле в тип рядка**

У `shared/card.ts`, в `interface LeadRow`, після `actor_name` додати:

```ts
  /** Чия це робота. Окремо від actor_name — того, хто останній
      змінив стан: коли власник перевішує заявку, натискає він, а
      робити її буде інший */
  assignee_name?: string | null;
```

- [ ] **Step 2: Показувати в картці виконавця**

У `shared/card.ts`, у `cardText`, замінити блок

```ts
  // У новій заявці рядка немає: брати її ще ніхто не встиг
  if (lead.status !== 'new' && lead.actor_name) {
    lines.push('', `Взяв: ${lead.actor_name}`);
  }
```

на

```ts
  /* Показуємо виконавця, а не того, хто останній натиснув: у групі
     важливо, чия це робота. Хто саме натиснув «Повернути», лишається в
     базі для розбору, але в картку не йде — інакше рядок мінявся б від
     кожної дрібниці.

     У новій заявці рядка немає: взяти її ще ніхто не встиг. */
  if (lead.status !== 'new' && lead.assignee_name) {
    lines.push('', `Майстер: ${lead.assignee_name}`);
  }
```

- [ ] **Step 3: Записувати виконавця, коли заявку беруть**

У `functions/api/tg.ts`, в `UPDATE` зміни стану, додати присвоєння
виконавця лише для переходу в роботу.

**Увага:** цей `UPDATE` уже має умовний рядок — `closed_at` дописується
тільки при закритті (`${closing ? … : ''}`), і в `.bind()` йому
відповідає умовний розкид `...(closing ? [now] : [])`. Нові значення
мусять стати **перед** цим розкидом, інакше порядок плейсхолдерів
розʼїдеться.

Знайти рядок `actor_name = ?,` і після нього додати:

```ts
                assignee_id = CASE WHEN ? = 'in_work' THEN ? ELSE assignee_id END,
                assignee_name = CASE WHEN ? = 'in_work' THEN ? ELSE assignee_name END,
```

У `.bind(...)` після `who` додати чотири значення. Повний виклик після
правки — із наявним умовним розкидом на місці:

```ts
      .bind(
        target,
        cq.from?.id ? String(cq.from.id) : null,
        who,
        target,
        fromId,
        target,
        who,
        ...(closing ? [now] : []),
        now,
        id,
        target
      )
```

Порядок плейсхолдерів у SQL після правки: `status`, `actor_id`,
`actor_name`, два для `assignee_id`, два для `assignee_name`, далі
необовʼязковий `closed_at`, `updated_at`, `id` і `status <> ?`.
`decline_reason = NULL` плейсхолдера не має.

- [ ] **Step 4: Передати виконавця в перемальовування**

У тому самому файлі, у виклику `drawCard` після зміни стану, рядок

```ts
    await drawCard(db, api, env.TELEGRAM_CHAT_ID, {
      ...row,
      status: target,
      actor_name: who,
      decline_reason: null,
    });
```

замінити на

```ts
    await drawCard(db, api, env.TELEGRAM_CHAT_ID, {
      ...row,
      status: target,
      actor_name: who,
      // Виконавець міняється лише коли заявку беруть; інакше лишається,
      // що був — так само, як в UPDATE вище
      assignee_name: target === 'in_work' ? who : row.assignee_name,
      decline_reason: null,
    });
```

- [ ] **Step 5: Додати поле у вибірку бота**

У `functions/api/tg.ts`, у константі `SELECT_LEAD`, до переліку колонок
додати `assignee_id, assignee_name`.

- [ ] **Step 6: Переконатися, що типи сходяться**

Run: `npm run check:functions && npm run crm:check`
Expected: обидві команди з кодом 0.

- [ ] **Step 7: Перевірити проти бази**

Підняти сайт зі сміттєвим токеном, як у Task 2. Завести заявку в стані
`new` з `chat_id = '1'` і натиснути «В роботу» від `from.id = 900000003`.

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "SELECT status, actor_id, actor_name, assignee_id, assignee_name FROM leads"
```

Expected: `status` = `in_work`, і `actor`, і `assignee` — `900000003`.

Далі натиснути «Виконано» від **іншого** `from.id = 900000004`:

Expected: `actor` став `900000004`, **`assignee` лишився `900000003`**.
Це й є сенс розділення: закрити може інший, а зробив її перший.

Прибрати за собою: заявки й рядки `users` із `tg_id LIKE '9000000%'`.

- [ ] **Step 8: Коміт**

```bash
git add shared/card.ts functions/api/tg.ts
git commit -m "Картка показує майстра, а не того, хто натиснув"
```

---

## Task 4: Вхід у CRM — лише власнику

**Files:**
- Modify: `crm/src/index.ts`

**Interfaces:**
- Consumes: роль із таблиці `users`
- Produces: сесія видається лише ролі `owner`; майстер отримує
  зрозумілу відмову

- [ ] **Step 1: Звузити перевірку при вході**

У `crm/src/index.ts`, у маршруті `GET /auth`, замінити запит

```ts
  const row = await c.env.DB.prepare('SELECT tg_id, active FROM users WHERE tg_id = ?')
    .bind(String(params.id))
    .first<{ tg_id: string; active: number }>();

  if (!row || row.active !== 1) {
    return c.html(loginPage(BOT_NAME, 'Цей обліковий запис не має доступу.'), 403);
  }
```

на

```ts
  const row = await c.env.DB.prepare('SELECT tg_id, active, role FROM users WHERE tg_id = ?')
    .bind(String(params.id))
    .first<{ tg_id: string; active: number; role: string }>();

  if (!row || row.active !== 1) {
    return c.html(loginPage(BOT_NAME, 'Цей обліковий запис не має доступу.'), 403);
  }

  /* Дві двері, а не одна. Кнопка в групі міняє стан однієї заявки, яку
     людина й так бачить у чаті; CRM показує всю базу — імена, телефони,
     історію, суми. Автоматичне заведення майстрів відчиняє лише першу,
     інакше будь-хто, кого колись додадуть у групу, отримав би заодно
     повний доступ до бази клієнтів. */
  if (row.role !== 'owner') {
    return c.html(
      loginPage(
        BOT_NAME,
        'CRM поки лише для власника. Заявками керуйте кнопками в групі.'
      ),
      403
    );
  }
```

- [ ] **Step 2: Звузити перевірку сесії**

У тому самому файлі, у середині автентифікації, замінити

```ts
  const viewer = await c.env.DB.prepare(
    'SELECT tg_id, name, role FROM users WHERE tg_id = ? AND active = 1'
  )
```

на

```ts
  // Роль перевіряється на кожному запиті, а не лише при вході: якщо
  // власник колись знизить комусь роль, сесія мусить померти негайно
  const viewer = await c.env.DB.prepare(
    "SELECT tg_id, name, role FROM users WHERE tg_id = ? AND active = 1 AND role = 'owner'"
  )
```

- [ ] **Step 3: Переконатися, що типи сходяться**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 4: Перевірити обидві відмови**

Підняти CRM: `npm run crm:dev` (порт 8789).

Завести майстра:

```sql
INSERT INTO users (tg_id, name, role, active, created_at)
VALUES ('900000005', 'ТЕСТ Майстер', 'master', 1, '2026-10-01T09:00:00.000Z');
```

Підписати сесію для `900000005` тим самим алгоритмом, що в
`crm/src/auth.ts` (HMAC-SHA256 від `tgId.exp` ключем `SESSION_SECRET`,
кука `crm_session=tgId.exp.підпис`), і звернутись із нею на `/`.

Expected: переадресація на `/login` — сесія майстра не працює.

Далі перевірити сам вхід: зібрати підпис Telegram для `id=900000005`
(SHA-256 від токена як ключ HMAC) і звернутись на `/auth`.

Expected: HTTP 403 і текст «CRM поки лише для власника».

Сесія власника (`577102344`) має й далі працювати: `/` → HTTP 200.

Прибрати тестового майстра за собою.

- [ ] **Step 5: Коміт**

```bash
git add crm/src/index.ts
git commit -m "У CRM заходить лише власник"
```

---

## Task 5: Сторінка «Люди»

**Files:**
- Create: `crm/src/views/users.ts`
- Modify: `crm/src/db.ts`, `crm/src/index.ts`, `crm/src/views/layout.ts`

**Interfaces:**
- Produces:
  - `listUsers(db: D1Database): Promise<UserRow[]>` — усі, найновіші знизу
  - `setUserActive(db: D1Database, tgId: string, active: boolean): Promise<void>`
  - `usersPage(rows: UserRow[], viewer: Viewer, error?: string)`

- [ ] **Step 1: Запити до бази**

У `crm/src/db.ts` додати, після `createLead`:

```ts
import type { UserRow } from '../../shared/users';

/** Усі люди, найстаріші зверху: порядок появи читається як історія */
export async function listUsers(db: D1Database): Promise<(UserRow & { created_at: string })[]> {
  const res = await db
    .prepare('SELECT tg_id, name, role, active, created_at FROM users ORDER BY created_at')
    .all<UserRow & { created_at: string }>();
  return res.results ?? [];
}

/**
 * Зняти або повернути доступ.
 *
 * Рядок не видаляємо ніколи: на ньому тримається історія «хто це
 * робив», і видалення осиротило б заявки, зроблені цією людиною.
 */
export async function setUserActive(
  db: D1Database,
  tgId: string,
  active: boolean
): Promise<void> {
  await db
    .prepare('UPDATE users SET active = ? WHERE tg_id = ?')
    .bind(active ? 1 : 0, tgId)
    .run();
}
```

- [ ] **Step 2: Сторінка**

Створити `crm/src/views/users.ts`:

```ts
import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { UserRow } from '../../../shared/users';
import { dateTime } from '../format';

type Row = UserRow & { created_at: string };

/**
 * Хто має доступ.
 *
 * Майстри заводяться самі, коли вперше тиснуть кнопку в групі, тож цей
 * список здебільшого читають, а не наповнюють. Єдина дія — зняти або
 * повернути доступ.
 */
export function usersPage(rows: Row[], viewer: Viewer, error?: string) {
  return layout(
    'Люди',
    html`<h1>Люди</h1>
      ${error ? html`<p class="warn">${error}</p>` : ''}
      <p class="muted">
        Майстри зʼявляються тут самі, коли вперше натискають кнопку під карткою
        в групі. Знятий доступ діє негайно — і в боті, і тут.
      </p>

      ${rows.map(
        (r) => html`<div class="card">
          <div class="card__top">
            <span class="chip">${r.role === 'owner' ? 'Власник' : 'Майстер'}</span>
            ${r.active ? '' : html`<span class="chip">доступ знято</span>`}
          </div>
          <div class="card__name">${r.name}</div>
          <div class="card__meta">З ${dateTime(r.created_at)}</div>
          ${r.role === 'owner'
            ? html`<p class="muted" style="margin:.6rem 0 0">
                Власнику доступ не знімається: інакше в CRM не зайшов би ніхто.
              </p>`
            : html`<form method="post" action="/users/${r.tg_id}/active" style="margin-top:.6rem">
                <input type="hidden" name="active" value="${r.active ? '0' : '1'}" />
                <button type="submit" class="btn btn--wide ${r.active ? 'btn--danger' : ''}">
                  ${r.active ? 'Зняти доступ' : 'Повернути доступ'}
                </button>
              </form>`}
        </div>`
      )}`,
    viewer,
    'users'
  );
}
```

- [ ] **Step 3: Маршрути**

У `crm/src/index.ts` додати імпорти:

```ts
import { listUsers, setUserActive } from './db';
import { usersPage } from './views/users';
```

і маршрути поряд із `/today`:

```ts
app.get('/users', async (c) => {
  return c.html(usersPage(await listUsers(c.env.DB), c.get('viewer')));
});

app.post('/users/:tgId/active', async (c) => {
  const tgId = c.req.param('tgId');
  const form = await c.req.formData();
  const active = String(form.get('active') ?? '') === '1';

  const target = await c.env.DB.prepare('SELECT tg_id, role FROM users WHERE tg_id = ?')
    .bind(tgId)
    .first<{ tg_id: string; role: string }>();

  if (!target) return c.notFound();

  /* Власнику доступ не знімається. Він єдиний, хто заходить у CRM, і
     знявши його собі, він замкнув би себе назовні — повернути було б
     нічим, крім правки бази руками. */
  if (target.role === 'owner') {
    return c.html(
      usersPage(await listUsers(c.env.DB), c.get('viewer'), 'Власнику доступ не знімається.'),
      400
    );
  }

  await setUserActive(c.env.DB, tgId, active);
  return c.redirect('/users');
});
```

- [ ] **Step 4: Пункт у шапці**

У `crm/src/views/layout.ts`, у `<nav>`, після посилання на `/new`
додати:

```ts
            <a href="/users" ${current === 'users' ? raw('aria-current="page"') : ''}>Люди</a>
```

- [ ] **Step 5: Переконатися, що типи сходяться**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 6: Перевірити сторінку й обидві дії**

Підняти CRM, завести тестового майстра:

```sql
INSERT INTO users (tg_id, name, role, active, created_at)
VALUES ('900000006', 'ТЕСТ Майстер', 'master', 1, '2026-10-01T09:00:00.000Z');
```

З кукою власника:

| Запит | Очікується |
|---|---|
| `GET /users` | HTTP 200, видно власника й «ТЕСТ Майстер» |
| `POST /users/900000006/active` з `active=0` | 302, у базі `active = 0` |
| `POST /users/900000006/active` з `active=1` | 302, у базі `active = 1` |
| `POST /users/577102344/active` з `active=0` | HTTP 400, у базі власник і далі `active = 1` |

Прибрати тестового майстра за собою.

- [ ] **Step 7: Коміт**

```bash
git add crm/src/views/users.ts crm/src/db.ts crm/src/index.ts crm/src/views/layout.ts
git commit -m "Сторінка «Люди»: хто має доступ і як його зняти"
```

---

## Task 6: Призначення заявки

**Files:**
- Modify: `crm/src/db.ts`, `crm/src/index.ts`, `crm/src/views/lead.ts`, `crm/src/views/leads.ts`

**Interfaces:**
- Consumes: `listUsers`, `applyChange`, `syncCard`
- Produces: `assignLead(db, id, assignee, by): Promise<void>`

- [ ] **Step 1: Додати колонки у вибірку CRM**

У `crm/src/db.ts`:

- у типі `LeadFull` після `source: string;` додати:

```ts
  assignee_id: string | null;
  assignee_name: string | null;
```

- у `LEAD_COLUMNS` до переліку додати `assignee_id, assignee_name`.

- [ ] **Step 2: Запит призначення**

У `crm/src/db.ts` після `setUserActive` додати:

```ts
/**
 * Перевісити заявку на майстра — або зняти виконавця зовсім.
 *
 * `actor` стає той, хто перевішує: він змінив стан. `assignee` —
 * обраний. Саме заради цієї різниці вони й розділені.
 *
 * Заявка в стані «Нова» переходить у «В роботі»: `new` означає «ніхто
 * ще не дивився», а призначена вже має господаря. Це єдиний спосіб
 * туди потрапити, крім кнопки «В роботу» в групі — запис на час стану
 * не міняє.
 */
export async function assignLead(
  db: D1Database,
  id: number,
  assignee: { id: string; name: string } | null,
  by: { id: string; name: string }
): Promise<void> {
  const lead = await getLead(db, id);
  if (!lead) return;

  const toWork = assignee !== null && lead.status === 'new';

  await db
    .prepare(
      `UPDATE leads
          SET assignee_id = ?,
              assignee_name = ?,
              actor_id = ?,
              actor_name = ?,
              ${toWork ? "prev_status = status, status = 'in_work'," : ''}
              updated_at = ?
        WHERE id = ?`
    )
    .bind(
      assignee?.id ?? null,
      assignee?.name ?? null,
      by.id,
      by.name,
      new Date().toISOString(),
      id
    )
    .run();
}
```

- [ ] **Step 3: Маршрут**

У `crm/src/index.ts`, поряд із рештою дій над заявкою:

```ts
app.post('/lead/:id/assign', async (c) => {
  const id = leadId(c.req.param('id'));
  const lead = id && (await getLead(c.env.DB, id));
  if (!id || !lead) return c.notFound();

  const form = await c.req.formData();
  const picked = String(form.get('assignee') ?? '');
  const viewer = c.get('viewer');

  /* Порожнє значення — «зняти виконавця». Стану при цьому не чіпаємо:
     заявка, яку вже брали, не стає знову новою — історія важливіша за
     охайність списку. */
  let assignee: { id: string; name: string } | null = null;

  if (picked) {
    const found = (await listUsers(c.env.DB)).find((u) => u.tg_id === picked && u.active === 1);
    if (!found) {
      return c.html(
        problemPage(viewer, id, 'Такого майстра немає', 'Оберіть когось зі списку активних.'),
        400
      );
    }
    assignee = { id: found.tg_id, name: found.name };
  }

  await assignLead(c.env.DB, id, assignee, { id: viewer.tg_id, name: viewer.name });
  c.executionCtx.waitUntil(syncCard(c.env, id));
  return c.redirect(`/lead/${id}`);
});
```

Додати до імпортів `assignLead`.

- [ ] **Step 4: Форма в картці заявки**

`leadPage` отримує список людей — змінити сигнатуру на

```ts
export function leadPage(
  lead: LeadFull,
  history: LeadFull[],
  viewer: Viewer,
  masters: { tg_id: string; name: string }[]
) {
```

і додати блок одразу після рядка з виконанням/причиною, перед
`<h2>Запис на час</h2>`:

```ts
      <h2>Майстер</h2>
      <form method="post" action="/lead/${lead.id}/assign">
        <select name="assignee" aria-label="Майстер">
          <option value="">— ніхто —</option>
          ${masters.map(
            (m) => html`<option value="${m.tg_id}" ${lead.assignee_id === m.tg_id ? 'selected' : ''}>
              ${m.name}
            </option>`
          )}
        </select>
        <button type="submit" class="btn btn--wide" style="margin-top:.5rem">Призначити</button>
      </form>
```

У маршруті `GET /lead/:id` передати список:

```ts
  const masters = (await listUsers(c.env.DB))
    .filter((u) => u.active === 1)
    .map((u) => ({ tg_id: u.tg_id, name: u.name }));
  return c.html(leadPage(lead, history, c.get('viewer'), masters));
```

- [ ] **Step 5: Виконавець у списку заявок**

У `crm/src/views/leads.ts`, у блоці `card__meta`, після рядка з авто й
давністю додати:

```ts
                  ${r.assignee_name ? html`<br />Майстер: ${r.assignee_name}` : ''}
```

- [ ] **Step 6: Переконатися, що типи сходяться**

Run: `npm run crm:check`
Expected: код 0.

- [ ] **Step 7: Перевірити призначення**

Підняти CRM зі сміттєвим токеном (щоб перемальовування картки нікуди не
пішло) і завести майстра та заявку:

```sql
INSERT INTO users (tg_id, name, role, active, created_at)
VALUES ('900000007', 'ТЕСТ Майстер', 'master', 1, '2026-10-01T09:00:00.000Z');

INSERT INTO leads (created_at, name, phone, photos, status, chat_id)
VALUES ('2026-10-01T09:00:00.000Z', 'ТЕСТ Призначення', '+380670000077', 0, 'new', '1');
```

| Дія | Очікується |
|---|---|
| `POST /lead/<id>/assign` з `assignee=900000007` | 302; `assignee` — майстер, `actor` — власник, `status` став `in_work`, `prev_status` — `new` |
| Те саме вдруге | 302; нічого не зламалось, `status` лишився `in_work` |
| `POST` з `assignee=` (порожнє) | 302; `assignee` порожній, **`status` лишився `in_work`** |
| `POST` з `assignee=999` (немає такого) | HTTP 400, рядок не змінився |
| `GET /lead/<id>` | HTTP 200, у списку видно «ТЕСТ Майстер» |

Прибрати за собою.

- [ ] **Step 8: Коміт**

```bash
git add crm/src/db.ts crm/src/index.ts crm/src/views/lead.ts crm/src/views/leads.ts
git commit -m "Призначення заявки на майстра"
```

---

## Task 7: README і приймання

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Описати майстрів у README**

У розділ `## CRM` додати підрозділ про доступи. Він мусить містити:

- **як зʼявляється майстер**: досить додати людину в групу, перше
  натискання кнопки заводить її автоматично з роллю «майстер»;
- **попередження великими словами**: кого додали в групу, той зможе
  міняти стани заявок — членство в групі і є межею довіри, і людина,
  яка додає когось «просто подивитись», має це знати;
- **дві двері**: кнопки в групі й вхід у CRM — різні речі; у CRM
  заходить лише власник, майстер отримує зрозумілу відмову;
- **як зняти доступ**: сторінка «Люди», діє негайно і в боті, і в CRM;
  знятий доступ не повертається сам, навіть якщо людина лишається в
  групі;
- **чому власнику доступ не знімається**;
- **виконавець і той, хто натиснув** — що це різні поля, що в картці
  Telegram показується виконавець, і що звіти мусять групувати за
  `assignee_id`, а не за іменем (копія імені не оновлюється);
- **міграція `0006_assignee.sql`** у переліках для розгортання —
  і в розділі про бота, і в продакшн-командах.

- [ ] **Step 2: Перевірити шляхи з README**

Run: `npm run validate`
Expected: код 0, і серед попереджень немає нових рядків «посилається
на … — такого файлу в проєкті немає».

- [ ] **Step 3: Приймання — сайт не зламано**

```bash
npm run validate >/dev/null 2>&1; echo "validate: $?"
npm run check:functions >/dev/null 2>&1; echo "типи функцій: $?"
npm run crm:check >/dev/null 2>&1; echo "типи CRM: $?"
npm run build >/dev/null 2>&1; echo "build (має бути 1): $?"
npm run build:preview >/dev/null 2>&1; echo "preview: $?"
npx lhci autorun >/dev/null 2>&1; echo "lighthouse: $?"
```

Expected: `0`, `0`, `0`, `1`, `0`, `0`.

- [ ] **Step 4: Приймання — наскрізь із живим ботом**

Підняти сайт, тунель, зареєструвати вебхук і підняти CRM. Надіслати
**одну** заявку з іменем на `ТЕСТ`.

У групі натиснути «В роботу» **своїм акаунтом власника**.

Expected: у картці зʼявився рядок «Майстер: …» з вашим імʼям; у базі
`assignee_id` дорівнює вашому номеру.

Далі в CRM відкрити цю заявку, перевісити її на іншого майстра (якщо
другого немає — завести рядок у `users` запитом) і переконатися, що
картка в групі перемальована з новим імʼям.

У звіті назвати точну кількість надісланого в Telegram.

- [ ] **Step 5: Прибрати тестові дані**

```bash
npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml \
  --command "DELETE FROM leads WHERE name LIKE 'ТЕСТ%'; DELETE FROM users WHERE tg_id LIKE '9000000%'"
```

Expected: у `users` лишається рівно один рядок — власник.

- [ ] **Step 6: Коміт**

```bash
git add README.md
git commit -m "README: майстри, доступи й дві двері"
```

---

## Що лишається поза цим планом

Екрани майстра в CRM (свій список, свій день, закриття із сумою) —
окреме рішення, яке варто ухвалювати тоді, коли майстер скаже, чого
йому бракує в Telegram. Фільтр списку заявок за майстром — туди ж: поки
майстрів двоє-троє, його замінює погляд.

Третій кусок — календар на тиждень. Четвертий — гроші та звіти; саме він
вирішить, чи чистити `amount`, коли заявку повертають із виконаної.
