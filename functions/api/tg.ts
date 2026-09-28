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
 * Секрет (Pages → Settings → Environment variables, тип Secret):
 *   TELEGRAM_WEBHOOK_SECRET
 */
import { cardText, clean, keyboard, kyivDate, type LeadRow, type Status } from '../_lib/card';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  DB?: D1Database;
}

/** Куди веде кожна кнопка. «Повернути» рахується окремо: цілі в нього
    немає, воно повертає в збережений попередній стан. */
const NEXT: Record<string, Status> = {
  work: 'in_work',
  done: 'done',
  decline: 'declined',
};

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

  try {
    const row = await env.DB.prepare(
      `SELECT id, created_at, name, phone, age, car, photos, status, prev_status,
              actor_name, chat_id, message_id
         FROM leads WHERE id = ?`
    )
      .bind(id)
      .first<LeadRow & { chat_id: string | null; message_id: number | null }>();

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

    // Ім'я в Telegram людина ставить собі сама: без clean() перенос
    // рядка всередині нього дописав би в картку рядок, що виглядає як
    // справжнє поле заявки. Якщо після очищення нічого не лишилось —
    // «невідомо», інакше в картці був би порожній рядок після «Взяв:».
    const who = clean(cq.from?.first_name || cq.from?.username || 'невідомо', 80) || 'невідомо';

    await env.DB.prepare(
      `UPDATE leads
          SET prev_status = status,
              status = ?,
              actor_id = ?,
              actor_name = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(target, String(cq.from?.id ?? ''), who, new Date().toISOString(), id)
      .run();

    const lead: LeadRow = { ...row, status: target, actor_name: who };

    // Рядок про попереднє звернення рахуємо заново, щоб він не зник
    // із картки після зміни стану
    const notes: string[] = [];
    const before = await env.DB.prepare(
      'SELECT created_at FROM leads WHERE phone = ? AND id <> ? ORDER BY created_at DESC LIMIT 1'
    )
      .bind(row.phone, id)
      .first<{ created_at: string }>();
    if (before) notes.push(`⚠️ Цей номер уже звертався: ${kyivDate(before.created_at)}`);

    if (row.chat_id && row.message_id) {
      const edited = await fetch(`${api}/editMessageText`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: row.chat_id,
          message_id: row.message_id,
          text: cardText(lead, notes),
          reply_markup: keyboard(lead),
        }),
      });

      // Telegram обмежує редагування старих повідомлень. Замовчувати
      // невдачу не можна: оператор натиснув і мусить побачити результат
      if (!edited.ok) {
        await fetch(`${api}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: row.chat_id,
            text: cardText(lead, notes),
            reply_markup: keyboard(lead),
          }),
        });
      }
    }

    await close(TOAST[target]);
  } catch {
    await close('Не вдалося змінити стан');
  }

  return okEmpty();
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : new Response('method not allowed', { status: 405 });
