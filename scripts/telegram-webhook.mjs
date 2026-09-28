/**
 * Реєстрація вебхука Telegram.
 *
 *   npm run telegram:webhook -- https://avtoskloua.com/api/tg
 *   npm run telegram:webhook -- --delete
 *
 * Токен і секрет читаються з .dev.vars і НІКОЛИ не друкуються — ані
 * повністю, ані частинами. Той самий принцип, що й у
 * telegram-chat-id.mjs.
 *
 * Скрипт спершу показує, що зареєстровано зараз: мовчки затирати
 * чужий вебхук не можна — на ньому може працювати щось інше.
 */
import { readFileSync } from 'node:fs';

const FILE = '.dev.vars';

const die = (msg) => {
  console.error(`\n✖  ${msg}\n`);
  process.exit(1);
};

let raw;
try {
  raw = readFileSync(FILE, 'utf8');
} catch {
  die(`Немає файлу ${FILE}.\n   Створіть його зі зразка:  cp .dev.vars.example .dev.vars`);
}

const env = Object.fromEntries(
  raw
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const token = env.TELEGRAM_BOT_TOKEN;
if (!token) die(`У ${FILE} порожній TELEGRAM_BOT_TOKEN.`);

const secret = env.TELEGRAM_WEBHOOK_SECRET;
if (!secret) {
  die(
    `У ${FILE} порожній TELEGRAM_WEBHOOK_SECRET.\n` +
      '   Вигадайте довгий випадковий рядок:\n' +
      '   node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"'
  );
}

const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) die(`Telegram відмовив на ${method}: ${data.description ?? 'без пояснення'}`);
  return data.result;
};

const info = await call('getWebhookInfo');
console.log(`\nЗараз зареєстровано: ${info.url || '(нічого)'}`);
if (info.pending_update_count) {
  console.log(`Непрочитаних оновлень: ${info.pending_update_count}`);
}
if (info.last_error_message) {
  console.log(`Остання помилка доставки: ${info.last_error_message}`);
}

const arg = process.argv[2];

if (arg === '--delete') {
  await call('deleteWebhook', { drop_pending_updates: false });
  console.log('\n✓ Вебхук знято\n');
  process.exit(0);
}

if (!arg || !/^https:\/\//.test(arg)) {
  console.log(
    '\nЩоб зареєструвати, передайте адресу:\n' +
      '   npm run telegram:webhook -- https://avtoskloua.com/api/tg\n' +
      '\nЩоб зняти:\n' +
      '   npm run telegram:webhook -- --delete\n'
  );
  process.exit(0);
}

await call('setWebhook', {
  url: arg,
  secret_token: secret,
  // Нас цікавлять лише натискання кнопок. Решту Telegram навіть не
  // надсилатиме — менше зайвих запитів до ендпоінта.
  allowed_updates: ['callback_query'],
});

console.log(`\n✓ Вебхук зареєстровано: ${arg}`);
console.log('   Секрет передано Telegram — він підставлятиме його в заголовок.\n');
