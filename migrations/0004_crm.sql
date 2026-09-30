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
