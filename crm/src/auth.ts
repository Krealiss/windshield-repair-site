/**
 * Вхід через Telegram: жодних паролів.
 *
 * Telegram Login Widget віддає дані користувача й підпис. Перевіряємо
 * HMAC-SHA256, де ключ — SHA-256 від токена бота: це доводить, що дані
 * справді від Telegram, а не підставлені в адресний рядок.
 *
 * Сесія — підписана кука без сховища. Відкликання доступу працює не
 * через строк куки, а через прапорець active у таблиці users: він
 * перевіряється на кожному запиті, бо в базу ми однаково ходимо.
 */
const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(keyData: ArrayBuffer | Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyData as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Порівняння, що не завершується на першій розбіжності */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Скільки живе підпис Telegram. Доба — рекомендація самого Telegram */
const LOGIN_MAX_AGE = 86400;

/**
 * Найкоротший секрет, який ми погоджуємося вважати секретом.
 *
 * Токен бота має вигляд `1234567890:AA…` — близько 46 символів;
 * SESSION_SECRET за README — два UUID, тобто 72. Тридцять два стоїть із
 * запасом нижче обох і відсікає рівно те, що нас цікавить: порожнє
 * значення й заглушку.
 */
export const MIN_SECRET_LEN = 32;

/**
 * Чи можна взагалі обслуговувати запити.
 *
 * Порожній `TELEGRAM_BOT_TOKEN` не ламав перевірку підпису, а
 * **відкривав** її: `enc.encode(undefined)` дає порожній масив, а
 * SHA-256 від порожнього входу — публічно відома константа
 * `e3b0c442…`. Нею можна підписати довільний `{id, auth_date}` і зайти
 * за будь-кого, чий `tg_id` є в `users`.
 *
 * Вікно не умоглядне: поки секрети Worker не поставлено, розгорнута CRM
 * стоїть саме в такому стані. Тому порожній або надто короткий секрет —
 * відмова на вході, а не підпис.
 *
 * Повертає назву змінної, якої бракує, або null, якщо все на місці.
 * Саму назву показати не страшно — це не значення.
 */
export function missingSecret(env: {
  TELEGRAM_BOT_TOKEN?: string;
  SESSION_SECRET?: string;
}): string | null {
  if ((env.TELEGRAM_BOT_TOKEN ?? '').length < MIN_SECRET_LEN) return 'TELEGRAM_BOT_TOKEN';
  if ((env.SESSION_SECRET ?? '').length < MIN_SECRET_LEN) return 'SESSION_SECRET';
  return null;
}

export async function verifyTelegramLogin(
  params: Record<string, string>,
  botToken: string
): Promise<boolean> {
  const given = params.hash;
  if (!given) return false;

  /* Другий рубіж того самого сторожа, що стоїть мідлварою в index.ts:
     функція перевірки підпису не має вміти сказати «так» без справжнього
     ключа, хоч би хто її покликав. */
  if ((botToken ?? '').length < MIN_SECRET_LEN) return false;

  // Рядок перевірки: усі поля, крім hash, за абеткою, через перенос
  const check = Object.keys(params)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');

  const secret = await crypto.subtle.digest('SHA-256', enc.encode(botToken));
  if (!sameSecret(await hmac(secret, check), given)) return false;

  // Старий підпис — відмова: інакше перехоплена адреса працювала б вічно
  const authDate = Number(params.auth_date ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > LOGIN_MAX_AGE) return false;

  return true;
}

const SESSION_TTL = 60 * 60 * 24 * 30;

export async function signSession(
  tgId: string,
  secret: string,
  ttlSeconds = SESSION_TTL
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const value = `${tgId}.${exp}`;
  return `${value}.${await hmac(enc.encode(secret), value)}`;
}

export async function readSession(
  cookie: string | undefined,
  secret: string
): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split('.');
  if (parts.length !== 3) return null;

  const [tgId, exp, sig] = parts;
  const value = `${tgId}.${exp}`;
  if (!sameSecret(await hmac(enc.encode(secret), value), sig)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;

  return tgId;
}
