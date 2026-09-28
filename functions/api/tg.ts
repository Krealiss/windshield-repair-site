/**
 * POST /api/tg — вебхук Telegram: натискання кнопок під заявкою.
 *
 * Ендпоінт публічний, тож єдиний захист — секрет, який Telegram
 * підставляє в заголовок кожного запиту. Перевіряємо його до розбору
 * тіла: чужий запит не має дійти навіть до JSON.parse.
 *
 * Відповідаємо 200 завжди, окрім чужого секрета. Telegram повторює
 * доставку на будь-який інший код, і той самий натиск прилетить ще раз.
 *
 * Той самий натиск може прилетіти двічі — і від людини, і від ретраю
 * Telegram. Тому кожна зміна стану тут ідемпотентна: повтор нічого не
 * переписує, а лише відповідає підказкою.
 *
 * Секрети (Pages → Settings → Environment variables, тип Secret):
 *   TELEGRAM_WEBHOOK_SECRET
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID — лише як запасний адресат картки-замінника
 */
import { cardText, clean, keyboard, kyivDate, type LeadRow, type Status } from '../_lib/card';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /* Потрібен лише як запасний адресат: якщо в заявці не збереглося
     chat_id, картку-замінник треба комусь надіслати. Знак питання
     навмисно — забута змінна не має валити обробник. */
  TELEGRAM_CHAT_ID?: string;
  DB?: D1Database;
}

/** Куди веде кожна кнопка. «Повернути» рахується окремо: цілі в нього
    немає, воно повертає в збережений попередній стан.

    Тип із `undefined`, бо callback_data приходить із повідомлення, яке
    могло надіслати старше покоління коду: для чужої дії тут порожньо,
    і перевірка нижче на це розрахована. */
const NEXT: Record<string, Status | undefined> = {
  work: 'in_work',
  done: 'done',
  decline: 'declined',
};

/** Стани, з яких працює «Повернути»: тільки вони показують цю кнопку */
const FINAL: Status[] = ['done', 'declined'];

/** Короткий підпис, який Telegram показує спливаючою підказкою */
const TOAST: Record<Status, string> = {
  new: 'Повернуто',
  in_work: 'У роботі',
  done: 'Виконано',
  declined: 'Відмова',
};

const okEmpty = () => new Response('ok', { status: 200 });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let update: {
    callback_query?: {
      id: string;
      data?: string;
      from?: { id?: number; first_name?: string; username?: string };
    };
  };
  try {
    update = await request.json();
  } catch {
    return okEmpty();
  }

  const cq = update.callback_query;
  if (!cq?.data) return okEmpty(); // не натискання кнопки — не наша справа

  /* Перевірки «натиснув власник» тут немає, і поки це безпечно:
     callback_query приходить лише з повідомлень, які надіслав сам бот, а
     надсилає він в один чат (TELEGRAM_CHAT_ID). chat_id для редагування
     беремо з бази, а не з оновлення, тож підробити адресата теж не
     виходить.

     Коли зʼявиться група з майстрами, натиснути зможе будь-хто, кого в
     неї додали, — і ось тут місце для перевірки cq.from.id за списком
     дозволених. Зараз такого списку в проєкті немає, тому й перевірки
     немає: вона б або пропускала всіх, або блокувала власника. */

  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const close = (text: string) =>
    fetch(`${api}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callback_query_id: cq.id, text }),
    }).catch(() => {});

  const [action, rawId] = cq.data.split(':');
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !env.DB) {
    // Без бази міняти нічого: кнопка лишилась від заявки, яку не
    // зберегли. Мовчати не можна — людина бачитиме годинник, що крутиться
    await close('Заявку не збережено');
    return okEmpty();
  }

  let changed = false; // чи встиг пройти UPDATE — від цього залежить текст помилки

  try {
    const row = await env.DB.prepare(
      `SELECT id, created_at, name, phone, age, car, photos, status, prev_status,
              actor_name, chat_id, message_id, notes
         FROM leads WHERE id = ?`
    )
      .bind(id)
      .first<
        LeadRow & { chat_id: string | null; message_id: number | null; notes: string | null }
      >();

    if (!row) {
      await close('Заявку не знайдено');
      return okEmpty();
    }

    // «Повернути» веде в стан, з якого заявка пішла у фінальний.
    // Він збережений окремим полем саме тому, що з «Відмови» шлях
    // може вести і в «Нову», і в «В роботі».
    const target = action === 'undo' ? (row.prev_status ?? 'new') : NEXT[action];
    if (!target) {
      await close('Невідома дія');
      return okEmpty();
    }

    /* Те саме натискання прилітає двічі частіше, ніж здається: оператор
       тапає по кнопці, яка «не відреагувала», Telegram повторює доставку
       на кожну невдачу, і двоє людей можуть натиснути одночасно. Тому
       обробник мусить бути ідемпотентним.

       Без цієї перевірки другий однаковий натиск записував би
       prev_status = status, і «Повернути» починало вести в той самий
       стан, з якого намагається вийти, — заявка ставала невиправною
       нічим, крім ручної правки бази. */
    if (row.status === target) {
      await close('Заявка вже в цьому стані');
      return okEmpty();
    }

    /* «Повернути» — окремий випадок: його ціль не стала, вона залежить
       від prev_status. Після успішного повернення заявка вже не у
       фінальному стані, кнопки «Повернути» під нею немає, і повторна
       доставка того самого натиску повела б її назад у фінал — тобто
       «двічі повернути» означало б «повернути й відмовити знову».
       Тому дозволяємо undo рівно там, де ця кнопка є. */
    if (action === 'undo' && !FINAL.includes(row.status)) {
      await close('Заявку вже повернуто');
      return okEmpty();
    }

    // Ім'я в Telegram людина ставить собі сама: без clean() перенос
    // рядка всередині нього дописав би в картку рядок, що виглядає як
    // справжнє поле заявки. Якщо після очищення нічого не лишилось —
    // «невідомо», інакше в картці був би порожній рядок після «Взяв:».
    const who = clean(cq.from?.first_name || cq.from?.username || 'невідомо', 80) || 'невідомо';

    /* `AND status <> ?` — другий рубіж проти того самого повтору. Два
       одночасні запити можуть обидва пройти перевірку вище, бо між
       SELECT і UPDATE немає транзакції; цієї умови досить, щоб другий
       не перезаписав prev_status значенням, рівним status.

       actor_id пишеться NULL, а не порожнім рядком: колонка nullable, і
       CRM шукатиме майстрів через IS NULL, яке порожнього рядка не
       побачить. */
    const written = await env.DB.prepare(
      `UPDATE leads
          SET prev_status = status,
              status = ?,
              actor_id = ?,
              actor_name = ?,
              updated_at = ?
        WHERE id = ? AND status <> ?`
    )
      .bind(
        target,
        cq.from?.id ? String(cq.from.id) : null,
        who,
        new Date().toISOString(),
        id,
        target
      )
      .run();

    // Нічого не змінилось — значить, поки ми читали рядок, інший запит
    // уже перевів заявку в цей самий стан. Він же й перемалює картку.
    if (Number(written.meta?.changes ?? 0) === 0) {
      await close('Заявка вже в цьому стані');
      return okEmpty();
    }
    changed = true;

    const lead: LeadRow = { ...row, status: target, actor_name: who };

    /* Попередження в картці. Перше рахуємо заново — воно залежить від
       інших рядків таблиці; решту читаємо з колонки notes, куди їх
       поклав /api/lead. Без неї перший же натиск стирав із картки
       підказку «фото не передалося».

       `created_at < ?`, а не `id <> ?`: «попереднє» звернення — те, що
       раніше за цю заявку. Умова «будь-яке інше» показувала на картці
       #5 дату заявки #9, тобто дату, якої на момент #5 ще не було. */
    const notes: string[] = [];
    const before = await env.DB.prepare(
      'SELECT created_at FROM leads WHERE phone = ? AND created_at < ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(row.phone, row.created_at)
      .first<{ created_at: string }>();
    if (before) notes.push(`⚠️ Цей номер уже звертався: ${kyivDate(before.created_at)}`);
    for (const note of (row.notes ?? '').split('\n')) {
      if (note.trim()) notes.push(note);
    }

    const text = cardText(lead, notes);
    const markup = keyboard(lead);

    /* Один шлях на дві біди: редагування не вдалося або редагувати
       нічого (зворотний запис message_id колись не пройшов). В обох
       випадках надсилаємо картку заново і запамʼятовуємо саме її — без
       цього наступний натиск редагував би те саме старе повідомлення й
       плодив ще одну картку, а стан у базі мінявся б без жодного сліду
       в чаті. */
    let drawn = false;

    if (row.chat_id && row.message_id) {
      const edited = await fetch(`${api}/editMessageText`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: row.chat_id,
          message_id: row.message_id,
          text,
          reply_markup: markup,
        }),
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

    if (!drawn) {
      const chatId = row.chat_id || env.TELEGRAM_CHAT_ID;
      if (chatId) {
        const sent = await fetch(`${api}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, reply_markup: markup }),
        });

        if (sent.ok) {
          try {
            const data = (await sent.json()) as {
              result?: { message_id?: number; chat?: { id?: number } };
            };
            const messageId = data.result?.message_id;
            const newChatId = data.result?.chat?.id;
            if (messageId && newChatId) {
              await env.DB.prepare('UPDATE leads SET chat_id = ?, message_id = ? WHERE id = ?')
                .bind(String(newChatId), messageId, id)
                .run();
            }
          } catch {
            // Картка в чаті вже є; не запамʼяталось — наступний натиск
            // надішле ще одну. Краще за втрачений стан.
          }
        }
      }
    }

    await close(TOAST[target]);
  } catch {
    /* Текст не має брехати: якщо UPDATE уже пройшов, стан змінено, і
       «не вдалося» підштовхувало б натиснути ще раз — тобто рівно до
       повтору, від якого ми щойно захищалися. */
    await close(changed ? 'Стан змінено, картку не перемалювало' : 'Не вдалося змінити стан');
  }

  return okEmpty();
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : new Response('method not allowed', { status: 405 });
