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

  if (f.from) {
    where.push('created_at >= ?');
    bind.push(f.from);
  }
  if (f.to) {
    where.push('created_at <= ?');
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
     тут, через локаль «uk». У `LIKE` `%` і `_` — шаблон, а не символи,
     тож екрануємо їх, інакше запит «%» збігся б з усім. */
  const like = `%${q.replace(/[!%_]/g, '!$&')}%`;
  const needle = q.toLocaleLowerCase('uk');

  const [byPhone, candidates] = await Promise.all([
    select(["phone LIKE ? ESCAPE '!'"], [like], SHOWN),
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
