/**
 * Хто має право діяти із заявками й хто — заходити в CRM.
 *
 * Спільний для бота (`functions/api/tg.ts`) і CRM (`crm/src/index.ts`):
 * правила доступу мусять лежати одним місцем на два інтерфейси, інакше
 * одна копія колись дозволить те, що друга забороняє. Бот кличе
 * `userForAction`, CRM — `findUser` на вході і `crmViewer` на кожному
 * запиті.
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

  /* Повертаємо лише того, хто має право: між вставкою і читанням доступ
     могли зняти, а виклик, що перевіряє лише на null, пропустив би
     рядок із active = 0. */
  const created = await findUser(db, tgId);
  return created?.active === 1 ? created : null;
}

/**
 * Хто може бути в CRM — або null.
 *
 * Двері окремі від кнопок у групі: кнопка міняє стан однієї заявки, яку
 * людина й так бачить у чаті, а CRM показує всю базу — імена, телефони,
 * історію, суми. Тому заведення тут немає взагалі, лише роль `owner` і
 * живий доступ.
 *
 * Читається на кожному запиті, а не лише при вході: кука живе 30 днів,
 * сховища сесій немає, і скасувати доступ інакше нічим.
 */
export async function crmViewer(
  db: D1Database,
  tgId: string
): Promise<{ tg_id: string; name: string; role: string } | null> {
  return db
    .prepare(
      "SELECT tg_id, name, role FROM users WHERE tg_id = ? AND active = 1 AND role = 'owner'"
    )
    .bind(tgId)
    .first<{ tg_id: string; name: string; role: string }>();
}
