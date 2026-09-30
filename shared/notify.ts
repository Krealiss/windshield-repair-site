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
