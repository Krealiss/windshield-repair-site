/**
 * POST /api/tg — вебхук Telegram: натискання кнопок під заявкою і
 * відповідь оператора з вільною причиною відмови.
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
 * Відколи в allowed_updates зʼявився `message`, сюди долітає **кожне**
 * повідомлення з чату, а не лише відповіді боту. Тому обробник
 * повідомлень мовчки виходить на все, що не є відповіддю на наш власний
 * запит причини: звʼязку «відповідь → заявка» ми не вгадуємо з тексту, а
 * читаємо з KV, куди її поклали під ключем, що містить номер того самого
 * запиту.
 *
 * Секрети (Pages → Settings → Environment variables, тип Secret):
 *   TELEGRAM_WEBHOOK_SECRET
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID — лише як запасний адресат картки-замінника
 */
import { clean, REASONS, type Status } from '../../shared/card';
import { call, drawCard, telegramApi, type NotifyRow } from '../../shared/notify';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /* Потрібен лише як запасний адресат: якщо в заявці не збереглося
     chat_id, картку-замінник треба комусь надіслати. Знак питання
     навмисно — забута змінна не має валити обробник. */
  TELEGRAM_CHAT_ID?: string;
  DB?: D1Database;
  /* Той самий простір, що тримає обмежувач заявок у /api/lead. Друге
     призначення — короткочасна памʼять «це повідомлення питало причину
     заявки #N», ключі з префіксом `reason:`. Окремий простір означав би
     ще одну привʼязку в панелі Cloudflare заради двох ключів, які живуть
     годину. */
  RATE?: KVNamespace;
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

/** Скільки живе памʼять про запит причини. Година — це «оператор
    відволікся й повернувся», і водночас достатньо коротко, щоб забутий
    запит не зловив випадкову відповідь наступного дня. */
const REASON_TTL = 3600;

/** Вільна причина обрізається: вона йде в картку, а картка ціла мусить
    уміщатися в лімітах Telegram. Двісті символів — це кілька речень,
    довше за них причина відмови не буває. */
const REASON_MAX = 200;

const SELECT_LEAD = `SELECT id, created_at, name, phone, age, car, photos, status, prev_status,
              actor_name, decline_reason, chat_id, message_id, notes
         FROM leads WHERE id = ?`;

/** Записати причину можна лише у відмову — звідси умова в обох UPDATE */
const SET_REASON = `UPDATE leads
      SET decline_reason = ?, updated_at = ?
    WHERE id = ? AND status = 'declined'`;

const okEmpty = () => new Response('ok', { status: 200 });

/**
 * Відповідь оператора з вільною причиною відмови.
 *
 * Сюди долітає будь-яке повідомлення з чату, тож функція мовчки виходить
 * на все, що не є відповіддю на наш власний запит. «Наш» означає: у KV є
 * ключ із номером повідомлення, на яке відповідають. Вгадувати за
 * текстом не можна — оператор пише в цей чат і сам собі.
 */
async function reasonFromReply(
  env: Env,
  api: string,
  msg: {
    message_id?: number;
    text?: string;
    chat?: { id?: number };
    reply_to_message?: { message_id?: number };
  }
): Promise<void> {
  const chatId = msg.chat?.id;
  const promptId = msg.reply_to_message?.message_id;
  const reason = clean(msg.text, REASON_MAX);
  if (!chatId || !promptId || !reason || !env.RATE || !env.DB) return;

  const key = `reason:${chatId}:${promptId}`;
  const rawId = await env.RATE.get(key);
  if (!rawId) return; // відповідь не на наш запит — не наша справа

  const id = Number(rawId);
  const db = env.DB;
  const store = env.RATE;
  const drop = (messageId: number) =>
    call(api, 'deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});

  const row = await db.prepare(SELECT_LEAD).bind(id).first<NotifyRow>();
  if (!row) {
    await store.delete(key);
    return;
  }

  /* Заявку встигли повернути з відмови, поки оператор писав. Причину в
     такому разі записувати нікуди — але й проковтнути текст молча не
     можна, інакше людина вважатиме, що причина збереглася. Запит
     прибираємо, відповідь лишаємо на місці: написане не має зникати
     разом із повідомленням про те, що воно не врахувалось. */
  if (row.status !== 'declined') {
    await store.delete(key);
    await drop(promptId);
    await call(api, 'sendMessage', {
      chat_id: chatId,
      text: `Заявка #${id} вже не у відмові — причину не записано.`,
    }).catch(() => {});
    return;
  }

  const written = await db
    .prepare(SET_REASON)
    .bind(reason, new Date().toISOString(), id)
    .run();

  if (Number(written.meta?.changes ?? 0) > 0) {
    await drawCard(db, api, env.TELEGRAM_CHAT_ID, { ...row, decline_reason: reason });
  }

  /* Прибираємо після запису, не до: якщо видалення не вдасться, причина
     вже в картці, і найгірше — два зайвих повідомлення в чаті. У
     зворотному порядку ми б видалили текст, який нікуди не дійшов. */
  await store.delete(key);
  await drop(promptId);
  if (msg.message_id) await drop(msg.message_id);
}

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
    message?: {
      message_id?: number;
      text?: string;
      chat?: { id?: number };
      reply_to_message?: { message_id?: number };
    };
  };
  try {
    update = await request.json();
  } catch {
    return okEmpty();
  }

  const api = telegramApi(env.TELEGRAM_BOT_TOKEN);

  if (update.message) {
    // Вільна причина відмови. Усе інше, що людина пише в чат, лишається
    // без відповіді — і це головна властивість цієї гілки.
    try {
      await reasonFromReply(env, api, update.message);
    } catch {
      // Мовчки: помилка тут не мусить ані валити вебхук, ані сипати в
      // чат повідомленнями на кожен сторонній рядок
    }
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

  const close = (text: string) =>
    call(api, 'answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => {});

  const [action, rawId] = cq.data.split(':');
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !env.DB) {
    // Без бази міняти нічого: кнопка лишилась від заявки, яку не
    // зберегли. Мовчати не можна — людина бачитиме годинник, що крутиться
    await close('Заявку не збережено');
    return okEmpty();
  }

  const db = env.DB;
  let changed = false; // чи встиг пройти запис — від цього залежить текст помилки

  try {
    const row = await db.prepare(SELECT_LEAD).bind(id).first<NotifyRow>();

    if (!row) {
      await close('Заявку не знайдено');
      return okEmpty();
    }

    /* Готова причина відмови. Стану не міняє, тому ідемпотентність тут
       інша: повторний натиск запише те саме значення, картка не
       зміниться, і Telegram відповість «message is not modified», яке
       drawCard() рахує успіхом. */
    const preset = /^r([0-9]+)$/.exec(action ?? '');
    if (preset) {
      const reason = REASONS[Number(preset[1])];
      if (!reason) {
        await close('Невідома причина');
        return okEmpty();
      }
      if (row.status !== 'declined') {
        await close('Причина буває лише у відмови');
        return okEmpty();
      }

      const written = await db
        .prepare(SET_REASON)
        .bind(reason, new Date().toISOString(), id)
        .run();
      changed = Number(written.meta?.changes ?? 0) > 0;

      if (changed) await drawCard(db, api, env.TELEGRAM_CHAT_ID, { ...row, decline_reason: reason });
      await close('Причину записано');
      return okEmpty();
    }

    /* Вільна причина: просимо написати її відповіддю. force_reply
       відкриває оператору поле відповіді, а номер того повідомлення ми
       кладемо в KV — інакше наступний текст у чаті нічим не звʼязати з
       заявкою. */
    if (action === 'rx') {
      if (!env.RATE) {
        await close('Вільна причина недоступна');
        return okEmpty();
      }
      if (row.status !== 'declined') {
        await close('Причина буває лише у відмови');
        return okEmpty();
      }

      const chatId = row.chat_id || env.TELEGRAM_CHAT_ID;
      if (!chatId) {
        await close('Немає куди надіслати запит');
        return okEmpty();
      }

      /* force_reply у групі поводиться інакше, ніж у особистих: без
         `selective` поле відповіді розкривається **всім** учасникам, а
         причину пише один. Telegram націлює його на тих, кого згадано
         в тексті, тож підставляємо @username того, хто натиснув.

         Якщо username немає (його ставлять не всі), `selective` не
         вмикаємо: краще зайве поле відповіді в кількох людей, ніж
         запит, якого не бачить ніхто. Імʼя в тексті лишається — воно
         підказує, кого чекають. */
      const username = clean(cq.from?.username, 64);
      const naming = username ? `@${username}` : clean(cq.from?.first_name, 64) || 'Оператор';

      const asked = await call(api, 'sendMessage', {
        chat_id: chatId,
        text: `${naming}, напишіть причину відмови для заявки #${id} у відповідь на це повідомлення.`,
        reply_markup: {
          force_reply: true,
          ...(username ? { selective: true } : {}),
          input_field_placeholder: 'Причина відмови',
        },
      });

      if (asked.ok) {
        const data = (await asked.json().catch(() => ({}))) as {
          result?: { message_id?: number; chat?: { id?: number } };
        };
        const promptId = data.result?.message_id;
        const promptChat = data.result?.chat?.id;
        if (promptId && promptChat) {
          await env.RATE.put(`reason:${promptChat}:${promptId}`, String(id), {
            expirationTtl: REASON_TTL,
          });
        }
      }

      await close('Напишіть причину у відповідь');
      return okEmpty();
    }

    // «Повернути» веде в стан, з якого заявка пішла у фінальний.
    // Він збережений окремим полем саме тому, що з «Відмови» шлях
    // може вести і в «Нову», і в «В роботі».
    const target = action === 'undo' ? (row.prev_status ?? 'new') : NEXT[action ?? ''];
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
       побачить.

       decline_reason скидається на кожній зміні стану — і це правильно
       в усіх трьох напрямках: у свіжій відмові причини ще немає, при
       поверненні вона стає неправдою, а при повторній відмові після
       повернення лишилася б стара. */
    const written = await db
      .prepare(
        `UPDATE leads
            SET prev_status = status,
                status = ?,
                actor_id = ?,
                actor_name = ?,
                decline_reason = NULL,
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

    await drawCard(db, api, env.TELEGRAM_CHAT_ID, {
      ...row,
      status: target,
      actor_name: who,
      decline_reason: null,
    });

    await close(TOAST[target]);
  } catch {
    /* Текст не має брехати: якщо запис уже пройшов, стан змінено, і
       «не вдалося» підштовхувало б натиснути ще раз — тобто рівно до
       повтору, від якого ми щойно захищалися. */
    await close(changed ? 'Стан змінено, картку не перемалювало' : 'Не вдалося змінити стан');
  }

  return okEmpty();
};

/** Будь-який інший метод на цей маршрут — не наша справа */
export const onRequest: PagesFunction<Env> = async ({ request, next }) =>
  request.method === 'POST' ? next() : new Response('method not allowed', { status: 405 });
