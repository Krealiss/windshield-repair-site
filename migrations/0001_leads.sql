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
