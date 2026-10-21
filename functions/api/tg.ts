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
 * Доступ. Усі дії бота — і кнопки, і вільна причина відмови — лише для
 * користувача з `users.active = 1`. Невідомого натискача кнопки
 * заводимо майстром, **але лише в групі власника**: членство в ній і є
 * рішення довіряти людині, а кнопка, яка колись полетить в особистий
 * чат клієнта, не мусить робити майстром клієнта. Знятий не воскресає:
 * його натискання отримує видиму відмову, а текстова відповідь тихо
 * ігнорується. Текстова відповідь нікого не заводить — лише кнопка.
 *
 * Секрети (Pages → Settings → Environment variables, тип Secret):
 *   TELEGRAM_WEBHOOK_SECRET
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID — запасний адресат картки-замінника й межа, у якому
 *     чаті натискач стає майстром
 */
import { syncCashback } from '../../shared/cashback';
import { clean, REASONS, type Status } from '../../shared/card';
import { call, drawCard, telegramApi, type NotifyRow } from '../../shared/notify';
import { findUser, userForAction } from '../../shared/users';

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /* Дві ролі. Перша — запасний адресат: якщо в заявці не збереглося
     chat_id, картку-замінник треба комусь надіслати. Друга — межа, у
     якому чаті натискач кнопки стає майстром.

     Знак питання навмисно: забута змінна не має валити обробник. Без неї
     межі немає, і це видно одразу, а не тихо — без адресата перша
     картка нікуди не йде, тобто бот просто не працює. */
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
              actor_name, assignee_id, assignee_name, decline_reason, chat_id, message_id, notes
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
    from?: { id?: number };
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

  /* Доступ. Запис причини — така сама дія над заявкою, як і кнопка, тож
     знятий користувач не мусить її виконати: запит бота висить у чаті
     для всіх, а `selective` лише підказує, кому показати поле відповіді.

     Стоїть після перевірки ключа, щоб не ходити в базу на кожне
     стороннє повідомлення в групі. `findUser`, а не `userForAction`:
     невідомого текстова відповідь майстром не робить — його заводить
     лише натискання кнопки.

     Вихід мовчазний: без повідомлення в чат і без видалення. Кнопки тут
     немає, тож підказку показати нічим, а нове повідомлення в групі —
     шум і натяк стороннім, що їх помітили. Запит лишається на місці,
     відповідь висить: нічого не виглядає прийнятим. */
  const fromId = msg.from?.id ? String(msg.from.id) : '';
  if (!fromId) return;
  const author = await findUser(env.DB, fromId);
  if (!author || author.active !== 1) return;

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
      message?: { chat?: { id?: number } };
    };
    message?: {
      message_id?: number;
      text?: string;
      from?: { id?: number };
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
      // Мовчки для чату: помилка тут не мусить ані валити вебхук, ані сипати
      // в чат повідомленнями на кожен сторонній рядок. У журнал — без значень.
      console.error('tg: збій обробки відповіді з причиною відмови');
    }
    return okEmpty();
  }

  const cq = update.callback_query;
  if (!cq?.data) return okEmpty(); // не натискання кнопки — не наша справа

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

  /* Хто натиснув. Імʼя беремо живе, з Telegram: воно свіжіше за копію
     в `users`, а в картку йде саме воно. Без clean() перенос рядка
     всередині імені дописав би в картку рядок, що виглядає як поле
     заявки. */
  const who = clean(cq.from?.first_name || cq.from?.username || 'невідомо', 80) || 'невідомо';
  const fromId = cq.from?.id ? String(cq.from.id) : '';

  if (!fromId) {
    await close('Не вдалося розпізнати, хто натиснув');
    return okEmpty();
  }

  /* Доступ. Невідомого заводимо майстром — людина вже в групі власника,
     а це й є рішення довіряти їй. Знятого не воскрешаємо.

     Відмова видима, а не мовчазна: мовчання людина прочитає як поломку
     бота й натисне ще кілька разів.

     Власний try: збій бази тут не мусить ставати 500. Telegram повторює
     доставку на будь-який код, крім 200, тож один збій перетворився б на
     нескінченні ретраї того самого натискання. Відповідаємо 200 і
     просимо людину натиснути ще раз. */
  /* Заводимо лише з групи власника. Поза нею дію виконує той, хто вже
     заведений, а нового не з'являється: інакше кнопка, надіслана
     колись в особистий чат клієнта, зробила б клієнта майстром. Коли
     TELEGRAM_CHAT_ID не заданий (локальний стенд), межі немає. */
  const inOwnerChat =
    !env.TELEGRAM_CHAT_ID || String(cq.message?.chat?.id ?? '') === env.TELEGRAM_CHAT_ID;

  let user: Awaited<ReturnType<typeof userForAction>>;
  try {
    if (inOwnerChat) {
      user = await userForAction(db, fromId, who);
    } else {
      const known = await findUser(db, fromId);
      user = known && known.active === 1 ? known : null;
    }
  } catch {
    // Без значень: лише що саме не вдалося, інакше в журнал потрапили б дані людини
    console.error('tg: не вдалося перевірити доступ до дій бота (таблиця users)');
    await close('Не вдалося перевірити доступ, спробуйте ще раз');
    return okEmpty();
  }
  if (!user) {
    await close('У вас немає доступу до заявок');
    return okEmpty();
  }

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

    /* «Повернути» веде в стан, з якого заявка пішла у фінальний. Він
       збережений окремим полем саме тому, що з «Відмови» шлях може
       вести і в «Нову», і в «В роботі».

       prev_status не беремо на віру. Інваріант «попередній стан ніколи
       не фінальний» тримає цей самий обробник, але рядок, записаний
       інакше (двоє натиснули різні кнопки під тією самою карткою, або
       одне натискання наклалося на зміну з CRM), замкнув би заявку між
       двома фіналами: «Повернути» ганяло б її по колу. Тому фінальне
       значення означає «нова» — так само, як у CRM
       (crm/src/index.ts, маршрут /undo). */
    const prev = row.prev_status;
    const target =
      action === 'undo'
        ? prev && !FINAL.includes(prev)
          ? prev
          : 'new'
        : NEXT[action ?? ''];
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

    /* Прямий перехід з одного фіналу в інший відхиляємо. Кнопки такої
       немає — keyboard() для фінального стану малює лише «Повернути», —
       але клавіатура в чаті застаріває: поки editMessageText не долетів,
       під карткою лишаються кнопки попереднього стану, і натиск «✅
       Виконано» під уже відмовленою заявкою дійшов би сюди. Тоді і
       status, і prev_status стали б фінальними — заявка замкнулася б між
       двома фіналами, бо «Повернути» ганяло б її з одного в інший. */
    if (FINAL.includes(row.status) && FINAL.includes(target)) {
      await close('Спершу «Повернути»');
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

    /* `AND status <> ?` — другий рубіж проти того самого повтору. Два
       одночасні запити можуть обидва пройти перевірку вище, бо між
       SELECT і UPDATE немає транзакції; цієї умови досить, щоб другий
       не перезаписав prev_status значенням, рівним status.

       decline_reason скидається на кожній зміні стану — і це правильно
       в усіх трьох напрямках: у свіжій відмові причини ще немає, при
       поверненні вона стає неправдою, а при повторній відмові після
       повернення лишилася б стара.

       closed_at пишеться лише коли кнопка закриває заявку. Без цього
       колонка лишалась би порожньою, і CRM при першому уточненні суми
       підставляла б туди момент уточнення — дату, яка не є датою
       закриття. Назад (при «Повернути») не чистимо: сума після
       повернення теж лишається, і правило «ці поля значать щось лише
       при status = 'done'» описане в crm/src/db.ts. */
    const now = new Date().toISOString();
    const closing = target === 'done';
    /* Виконавця ставить лише кнопка «В роботу». Дивимось на дію, а не на
       ціль переходу: в `in_work` веде ще й «Повернути» зі «Виконано», а
       воно не змінює, чия це робота — його може натиснути будь-хто.
       Саме заради цієї різниці actor і assignee — окремі поля. */
    const takes = action === 'work';
    /* Повернення в «Нову» знімає виконавця: «Нова» означає «нічия», і
       саме на цьому стоїть призначення в CRM. Повернення в «В роботі»
       (із «Виконано») виконавця не чіпає — робота лишається тією ж. */
    const released = target === 'new';
    /* У фінал ведемо лише з живого стану, і вирішує це сам UPDATE.
       Перевірки вище стоять на рядку, прочитаному раніше, а за цей час
       CRM могла заявку вже закрити — тоді фінальними стали б і status,
       і prev_status, і «Повернути» загубило б справжній попередній
       стан. На законному шляху умова нічого не змінює. */
    const toFinal = FINAL.includes(target);
    const written = await db
      .prepare(
        `UPDATE leads
            SET prev_status = status,
                status = ?,
                actor_id = ?,
                actor_name = ?,
                decline_reason = NULL,${takes ? '\n                assignee_id = ?,\n                assignee_name = ?,' : ''}${released ? '\n                assignee_id = NULL,\n                assignee_name = NULL,' : ''}${closing ? '\n                closed_at = ?,' : ''}
                updated_at = ?
          WHERE id = ? AND status <> ?${toFinal ? " AND status NOT IN ('done', 'declined')" : ''}`
      )
      .bind(
        target,
        fromId,
        who,
        ...(takes ? [fromId, who] : []),
        ...(closing ? [now] : []),
        now,
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

    /* Кешбек. «Виконано» і «Повернути» міняють, скільки заявці належить,
       хоч суму бот не чіпає ніколи. Синхронізація йде до перемальовування
       картки: картка має малюватися вже з актуальним журналом.

       Рядок перечитуємо заново, а не збираємо з `row` із підміною стану:
       `row` прочитано до запису, і за цей час CRM могла вписати суму.
       Журнал рахує з того, що в базі зараз. Зайвий читальний запит —
       прийнятна ціна.

       Власний try: збій тут не мусить ні валити обробник (Telegram
       повторював би доставку на будь-який код, крім 200), ні забирати в
       людини перемальовану картку — стан уже змінено. Повторне натискання
       тут не допоможе (воно впреться в «вже в цьому стані»), тож у журнал
       іде номер заявки, за яким можна знайти й виправити розбіжність;
       наступна зміна заявки її й так вирівняє. Без значень з рядка. */
    try {
      const fresh = await db
        .prepare('SELECT id, phone, status, amount FROM leads WHERE id = ?')
        .bind(id)
        .first<{ id: number; phone: string; status: string; amount: number | null }>();
      if (fresh) await syncCashback(db, fresh);
    } catch {
      console.error(`tg: журнал кешбеку не синхронізовано (заявка #${id})`);
    }

    await drawCard(db, api, env.TELEGRAM_CHAT_ID, {
      ...row,
      status: target,
      actor_name: who,
      // Виконавець міняється лише кнопкою «В роботу»; інакше лишається,
      // що був — так само, як в UPDATE вище
      assignee_name: takes ? who : released ? null : row.assignee_name,
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
