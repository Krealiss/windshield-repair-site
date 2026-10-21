/**
 * Кешбек: скільки належить клієнтові за закриті заявки.
 *
 * Лише накопичення — списання не існує. Нарахування лежать у журналі
 * (таблиця `cashback`, міграція 0008), а баланс — це сума журналу за
 * номером телефона. Окремого поля «баланс» немає ніде: воно розійшлося б
 * із подіями, з яких складене.
 *
 * Тека `shared/` спільна для воркера CRM і для Pages Functions, тому тут
 * немає імпортів із `crm/`.
 */

/** Відсоток від суми закритої заявки. Константа, а не змінна оточення:
    зміна відсотка — подія раз на рік, і вона мусить лишити слід у git. */
export const CASHBACK_PCT = 10;

export type CashbackRow = { id: number; lead_id: number; kop: number; created_at: string };

/**
 * Скільки копійок заявці належить зараз: відсоток від `amount`, якщо
 * заявка виконана й сума є; інакше нуль. Округлення вниз: пообіцяти
 * менше й віддати більше краще, ніж навпаки.
 *
 * `amount` тут у копійках, як і в `leads.amount`. Стару суму після
 * «Повернути» ніхто не чистить, тому повторне закриття без нової суми
 * дає знову те саме нарахування — це та сама робота за ту саму суму.
 */
export function earnedKop(lead: { status: string; amount: number | null }): number {
  if (lead.status !== 'done' || lead.amount === null) return 0;
  return Math.floor((lead.amount * CASHBACK_PCT) / 100);
}

/**
 * Приводить журнал у відповідність до заявки: дописує одним рядком
 * різницю між тим, що належить зараз, і тим, що вже записано за заявкою.
 * Нічого не редагує й не видаляє. Повторний виклик з тими самими даними
 * різниці не знаходить і рядка не пише — тож повторна доставка того
 * самого натискання в боті нешкідлива.
 *
 * Різниця рахується всередині `INSERT … SELECT`, а не в коді. Якби код
 * спершу читав суму журналу, а потім писав, два одночасні виклики
 * побачили б однаковий стан і дописали б по повному нарахуванню кожен.
 * В одному запиті другий бачить рядок першого.
 */
export async function syncCashback(
  db: D1Database,
  lead: { id: number; phone: string; status: string; amount: number | null }
): Promise<void> {
  const owed = earnedKop(lead);
  await db
    .prepare(
      `INSERT INTO cashback (phone, lead_id, kop, created_at)
       SELECT ?, ?, ? - s.total, ?
         FROM (SELECT COALESCE(SUM(kop), 0) AS total FROM cashback WHERE lead_id = ?) AS s
        WHERE ? - s.total <> 0`
    )
    .bind(lead.phone, lead.id, owed, new Date().toISOString(), lead.id, owed)
    .run();
}

/** Баланс людини за номером, у копійках. */
export async function balanceKop(db: D1Database, phone: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(kop), 0) AS total FROM cashback WHERE phone = ?')
    .bind(phone)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Рядки журналу за номером, найновіші зверху. `id` в упорядкуванні, бо
    два рядки можуть мати однакову мітку часу. */
export async function ledgerByPhone(db: D1Database, phone: string): Promise<CashbackRow[]> {
  const res = await db
    .prepare(
      'SELECT id, lead_id, kop, created_at FROM cashback WHERE phone = ? ORDER BY created_at DESC, id DESC'
    )
    .bind(phone)
    .all<CashbackRow>();
  return res.results;
}
