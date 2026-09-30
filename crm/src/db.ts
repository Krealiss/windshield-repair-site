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
    /* `%` і `_` у пошуковому рядку — звичайні символи, а не шаблон:
       екрануємо їх, інакше запит «%» збігся б з усім */
    where.push("(phone LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')");
    const like = `%${f.q.replace(/[!%_]/g, '!$&')}%`;
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
