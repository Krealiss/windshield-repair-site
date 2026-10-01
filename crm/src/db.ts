import type { LeadRow, Status } from '../../shared/card';

export type LeadFull = LeadRow & {
  chat_id: string | null;
  message_id: number | null;
  notes: string | null;
  appointment_at: string | null;
  closed_at: string | null;
  amount: number | null;
  work_note: string | null;
  /** site | phone — звідки прийшла заявка */
  source: string;
};

export const LEAD_COLUMNS = `id, created_at, name, phone, age, car, photos, status,
  prev_status, actor_name, decline_reason, chat_id, message_id, notes,
  appointment_at, closed_at, amount, work_note, source`;

/** Скільки заявок показує список і скільки рядків переглядає пошук за імʼям */
const SHOWN = 200;
const SCAN = 1000;

export type Filter ={ q?: string; status?: string; from?: string; to?: string };

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

  /* Вікно напіввідкрите, [from, to): `to` — це початок доби, яка вже не
     входить. Київська доба не має фіксованої тривалості (двічі на рік
     23 або 25 годин), тож «кінець дня» рахує той, хто знає часовий пояс
     — crm/src/index.ts через kyivDayBounds. Так само робить listDay(). */
  if (f.from) {
    where.push('created_at >= ?');
    bind.push(f.from);
  }
  if (f.to) {
    where.push('created_at < ?');
    bind.push(f.to);
  }

  const select = async (extra: string[], extraBind: unknown[], limit: number) => {
    const all = [...where, ...extra];
    const sql =
      `SELECT ${LEAD_COLUMNS} FROM leads` +
      (all.length ? ` WHERE ${all.join(' AND ')}` : '') +
      ` ORDER BY created_at DESC LIMIT ${limit}`;
    const res = await db.prepare(sql).bind(...bind, ...extraBind).all<LeadFull>();
    return res.results ?? [];
  };

  const q = (f.q ?? '').trim();
  if (!q) return select([], [], SHOWN);

  /* SQLite складає регістр (LIKE, lower) лише для ASCII: «петро» не
     знайде «Петро». Тому номер (ASCII) шукаємо в SQL, а імена звіряємо
     тут, через локаль «uk». */
  const needle = q.toLocaleLowerCase('uk');

  /* Номер нормалізуємо до цифр: власник копіює його з контактів разом із
     пробілами, дужками й дефісами («067 000 0002»), а в базі лежить
     рівно `+380670000002`. Без цього половина запиту, що йде в `phone
     LIKE`, не знаходила нічого.

     Шукаємо за номером лише від чотирьох цифр. Одна-дві цифри в запиті
     майже завжди частина імені («Golf 4», «Іван 3»), а не телефона — і
     вони знаходилися б у кожному номері: «3» є в усіх «+380». Чотири —
     найкоротший уламок, який ще щось звужує.

     Нуль цифр теж нічого не шукає окремо: порожній шаблон `%%` збігся б
     із кожним рядком. Екранувати `%` і `_` більше нема чого — після
     заміни в рядку лише цифри; сам `ESCAPE '!'` лишається як захист
     умови від майбутньої правки. */
  const digits = q.replace(/\D/g, '');
  const byNumber = digits.length >= 4;

  const [byPhone, candidates] = await Promise.all([
    byNumber ? select(["phone LIKE ? ESCAPE '!'"], [`%${digits}%`], SHOWN) : Promise.resolve([]),
    select([], [], SCAN),
  ]);

  const found = new Map<number, LeadFull>();
  for (const r of byPhone) found.set(r.id, r);
  for (const r of candidates) {
    if (r.name.toLocaleLowerCase('uk').includes(needle)) found.set(r.id, r);
  }

  /* Ліміт застосовуємо після фільтрації імен, щоб він не з'їв збіги */
  return [...found.values()]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
    .slice(0, SHOWN);
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

/**
 * Записані на добу від `dayStart` (ISO) — список на день.
 *
 * Лише живі заявки: appointment_at не чиститься, коли заявка виходить у
 * фінал, і відмовлена чи виконана опинилася б у розписі.
 */
export async function listDay(db: D1Database, dayStart: string, dayEnd: string) {
  const res = await db
    .prepare(
      `SELECT ${LEAD_COLUMNS} FROM leads
        WHERE appointment_at >= ? AND appointment_at < ?
          AND status IN ('new', 'in_work')
        ORDER BY appointment_at`
    )
    .bind(dayStart, dayEnd)
    .all<LeadFull>();
  return res.results ?? [];
}

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
 *
 * **Інваріант: `amount`, `work_note` і `closed_at` значать щось лише
 * при `status = 'done'`.** «Повернути» їх не чистить навмисно — щоб
 * помилкове повернення не з'їло суму, яку оператор уже вписав, — тож у
 * поверненої чи потім відмовленої заявки там може лежати стара правда.
 * Усі три місця показу (картка заявки, рядок клієнта, підсумок клієнта)
 * читають суму тільки під `status === 'done'`, і майбутні звіти мусять
 * робити так само: `SELECT sum(amount)` без цієї умови завищить дохід.
 */
/**
 * Заводить заявку, яку оператор записав зі слів клієнта по телефону.
 *
 * Стан одразу `in_work`, а не `new`: «нова» означає «ніхто ще не
 * дивився», а тут оператор щойно говорив із людиною. Виконавцем
 * стає той, хто заводить, — так само, як бот записує того, хто
 * натиснув кнопку.
 *
 * `photos` нуль і не передається: по телефону знімків не буває. Якщо
 * клієнт потім надішле фото, це видно буде в чаті, а не тут.
 */
export async function createLead(
  db: D1Database,
  data: {
    name: string;
    phone: string;
    age: string | null;
    car: string | null;
    appointment_at: string | null;
    actor_id: string;
    actor_name: string;
  }
): Promise<number> {
  const now = new Date().toISOString();

  // last_row_id, а не RETURNING: перше є в D1 завжди, друге залежить
  // від версії рушія — той самий вибір, що й у воркері сайту
  const res = await db
    .prepare(
      `INSERT INTO leads
         (created_at, name, phone, age, car, photos, status, prev_status,
          actor_id, actor_name, updated_at, appointment_at, source)
       VALUES (?, ?, ?, ?, ?, 0, 'in_work', 'new', ?, ?, ?, ?, 'phone')`
    )
    .bind(
      now,
      data.name,
      data.phone,
      data.age,
      data.car,
      data.actor_id,
      data.actor_name,
      now,
      data.appointment_at
    )
    .run();

  return Number(res.meta?.last_row_id ?? 0);
}

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
