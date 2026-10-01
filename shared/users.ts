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

  /* Повертаємо лише того, хто має право: між вставкою і читанням доступ
     могли зняти, а виклик, що перевіряє лише на null, пропустив би
     рядок із active = 0. */
  const created = await findUser(db, tgId);
  return created?.active === 1 ? created : null;
}
