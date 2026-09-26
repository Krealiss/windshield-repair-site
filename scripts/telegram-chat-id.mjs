#!/usr/bin/env node
/**
 * Показує chat_id для TELEGRAM_CHAT_ID.
 *
 *     npm run telegram:chat-id
 *
 * Навіщо окремий скрипт: свій chat_id неможливо побачити в інтерфейсі
 * Telegram, його віддає лише API. Просити когось «дістати id» вручну —
 * це або сторонній бот, якому доведеться довіритися, або curl із
 * токеном у командному рядку, звідки він потрапляє в історію оболонки.
 *
 * Токен читається з .dev.vars і НІКОЛИ не друкується — ані повністю,
 * ані частково. Усе відбувається на вашій машині.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FILE = '.dev.vars';

const die = (msg) => {
  console.error(`\n✖  ${msg}\n`);
  process.exit(1);
};

if (!existsSync(FILE)) {
  die(
    `Немає файлу ${FILE}.\n` +
      '   Створіть його з зразка:  cp .dev.vars.example .dev.vars\n' +
      '   і вставте туди токен від @BotFather.'
  );
}

/** Розбір KEY=VALUE: без залежностей, бо формат простіший за будь-яку бібліотеку */
const env = {};
for (const line of (await readFile(FILE, 'utf8')).split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const token = env.TELEGRAM_BOT_TOKEN;
if (!token) {
  die(`У ${FILE} порожній TELEGRAM_BOT_TOKEN.\n   Візьміть його в @BotFather: /newbot`);
}

const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

async function call(method) {
  let res;
  try {
    res = await fetch(api(method));
  } catch {
    die('Не вдалося зв\'язатися з api.telegram.org. Перевірте інтернет.');
  }
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    const why = data?.description ?? `HTTP ${res.status}`;
    if (res.status === 401) {
      die(`Telegram відхилив токен (${why}).\n   Скопіюйте його з @BotFather ще раз — цілком, без пробілів.`);
    }
    die(`Telegram відповів помилкою: ${why}`);
  }
  return data.result;
}

// ── 1. Чи живий бот ───────────────────────────────────────
const me = await call('getMe');
console.log(`\n✓  Бот на звʼязку: @${me.username}`);

// ── 2. Пробна заявка, якщо обидві змінні вже заповнені ────
if (process.argv.includes('--test')) {
  if (!env.TELEGRAM_CHAT_ID) {
    die(`У ${FILE} порожній TELEGRAM_CHAT_ID. Спершу запустіть команду без --test.`);
  }
  const res = await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text:
        '🔧 Перевірка звʼязку\n' +
        'Якщо ви це бачите — бот і чат налаштовані правильно.\n' +
        'Саме так виглядатимуть заявки з сайту.',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    die(
      `Не вдалося надіслати: ${data?.description ?? `HTTP ${res.status}`}\n` +
        '   Найчастіша причина — бот не знає цього чату.\n' +
        `   Напишіть @${me.username} у Telegram і спробуйте знову.`
    );
  }
  console.log('\n✓  Повідомлення надіслано. Перевірте Telegram.\n');
  process.exit(0);
}

// ── 3. Хто йому писав ─────────────────────────────────────
const updates = await call('getUpdates');

const chats = new Map();
for (const u of updates) {
  const msg = u.message ?? u.channel_post ?? u.edited_message;
  const chat = msg?.chat;
  if (chat && !chats.has(chat.id)) chats.set(chat.id, chat);
}

if (chats.size === 0) {
  console.log(
    '\n⚠  Поки що жодного повідомлення.\n' +
      `   Відкрийте Telegram, знайдіть @${me.username}, натисніть Start\n` +
      '   і напишіть боту будь-що. Потім запустіть цю команду ще раз.\n'
  );
  process.exit(0);
}

console.log('\nЗнайдені чати:\n');
for (const c of chats.values()) {
  const name = c.title ?? [c.first_name, c.last_name].filter(Boolean).join(' ') ?? '—';
  const kind = c.type === 'private' ? 'особистий' : c.type;
  console.log(`   ${String(c.id).padEnd(16)} ${kind.padEnd(10)} ${name}`);
}

const [first] = chats.values();
console.log(
  `\nВізьміть потрібний id і впишіть у ${FILE}:\n\n` +
    `   TELEGRAM_CHAT_ID=${first.id}\n\n` +
    'Далі перезапустіть локальний сервер — і форма на сайті\n' +
    'почне слати заявки в цей чат.\n'
);

if (env.TELEGRAM_CHAT_ID) {
  console.log(`(зараз у ${FILE} записано: ${env.TELEGRAM_CHAT_ID})\n`);
}
