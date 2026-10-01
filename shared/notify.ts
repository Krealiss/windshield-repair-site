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

/**
 * Невдача перемальовування — у журнал.
 *
 * Код відповіді й `description` від Telegram: 401 означає відкликаний
 * токен, 400 — зіпсований текст, 403 — бота вигнали з групи, і без
 * цього рядка всі три виглядали б однаково, тобто ніяк.
 *
 * **Адресу запиту не пишемо: у ній токен бота.** Те саме правило, що в
 * crm/src/sync.ts, де з помилки fetch беруть лише її назву.
 */
function fail(leadId: number, what: string): void {
  console.error(`drawCard: картку заявки #${leadId} не перемальовано — ${what}`);
}

/**
 * Перемальовує картку заявки в Telegram із того, що зараз у базі.
 *
 * `row` — рядок таблиці `leads` разом із `chat_id`, `message_id` і
 * `notes`; текст і кнопки беруться з `shared/card.ts`, тож бот і CRM
 * малюють однакову картку. `fallbackChatId` — куди надіслати, якщо в
 * заявці адресата не збереглося.
 *
 * Не кидає: заявка в базі вже змінена, і втратити зміну через
 * недоступний Telegram гірше, ніж мати неперемальовану картку. Але й не
 * мовчить — кожна невдача йде в журнал, інакше відкликаний токен
 * зупинив би синхронізацію без жодного сліду.
 *
 * Що саме відбувається, по порядку: рахуємо попередження → редагуємо
 * наявне повідомлення → якщо не вдалося, надсилаємо нове й запамʼятовуємо
 * його номер.
 */
export async function drawCard(
  db: D1Database,
  api: string,
  fallbackChatId: string | undefined,
  row: NotifyRow
): Promise<void> {
  /* Попередження в картці. Перше рахуємо заново — воно залежить від
     інших рядків таблиці; решту читаємо з колонки notes, куди їх поклав
     /api/lead. Без неї перший же натиск стирав із картки підказку «фото
     не передалося».

     `created_at < ?`, а не `id <> ?`: «попереднє» звернення — те, що
     раніше за цю заявку. Умова «будь-яке інше» показувала на картці #5
     дату заявки #9, тобто дату, якої на момент #5 ще не було. */
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

  /* Один шлях на дві біди: редагування не вдалося або редагувати нічого
     (зворотний запис message_id колись не пройшов). В обох випадках
     надсилаємо картку заново і запамʼятовуємо саме її — без цього
     наступна зміна редагувала б те саме старе повідомлення й плодила ще
     одну картку, а стан у базі мінявся б без жодного сліду в чаті. */
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
      // Не фатально — нижче буде спроба надіслати картку заново, — але
      // саме цей рядок пояснює, чому в чаті зʼявився другий екземпляр
      else fail(row.id, `editMessageText ${edited.status} ${why.description ?? ''}`);
    }
  }

  if (drawn) return;

  const chatId = row.chat_id || fallbackChatId;
  if (!chatId) {
    fail(row.id, 'немає куди надіслати: ні chat_id у заявці, ні TELEGRAM_CHAT_ID');
    return;
  }

  const sent = await call(api, 'sendMessage', { chat_id: chatId, text, reply_markup: markup });
  if (!sent.ok) {
    /* Головне місце журналу. Відкликаний або перевипущений токен дає тут
       401, і без цього рядка картки в групі просто тихо перестали б
       оновлюватися: drawCard нічого не кидає, тож catch у викликачах не
       спрацьовує. */
    const why = (await sent.json().catch(() => ({}))) as { description?: string };
    fail(row.id, `sendMessage ${sent.status} ${why.description ?? ''}`);
    return;
  }

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
  } catch (err) {
    /* Картка в чаті вже є; не запамʼяталось — наступна зміна надішле ще
       одну. Краще за втрачений стан: заявка з карткою без message_id
       хоч видима, а втрачена зміна — ні. Лише назва помилки: текст може
       містити адресу запиту, а в ній токен. */
    fail(row.id, `номер картки не записано: ${err instanceof Error ? err.name : 'unknown'}`);
  }
}
