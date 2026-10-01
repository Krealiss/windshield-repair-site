#!/usr/bin/env node
/**
 * Заводить власника в таблицю users.
 *
 *     npm run crm:seed-owner            → локальна база
 *     npm run crm:seed-owner -- --remote → продакшн
 *
 * Навіщо скрипт, а не міграція: міграція — це чистий SQL, вона не вміє
 * читати змінні оточення, а вписати особистий номер власника у файл під
 * git означав би покласти його персональні дані в публічний репозиторій.
 *
 * Без цього рядка в CRM неможливо зайти взагалі: доступ вимагає запису
 * в users, а завести запис може лише той, хто вже зайшов.
 */
import { execSync } from 'node:child_process';
import { DEV_VARS as FILE, readDevVars } from './_dev-vars.mjs';

const die = (msg) => {
  console.error(`\n✖  ${msg}\n`);
  process.exit(1);
};

const remote = process.argv.includes('--remote');

const env = readDevVars(() => ({}));
const tgId = process.env.OWNER_TG_ID || env.OWNER_TG_ID;

if (!tgId) {
  die(
    `Немає OWNER_TG_ID — ні в оточенні, ні в ${FILE}.\n` +
      '   Це особистий Telegram-номер власника, не номер групи.\n' +
      '   Дізнатися: напишіть боту в особисті й запустіть\n' +
      '   npm run telegram:chat-id — ваш особистий чат буде в списку.'
  );
}

if (!/^[0-9]+$/.test(String(tgId))) {
  die(
    `OWNER_TG_ID має бути додатним числом, а не «${tgId}».\n` +
      '   Відʼємне число — це номер групи (TELEGRAM_CHAT_ID), а тут\n' +
      '   потрібен номер людини.'
  );
}

const sql =
  "INSERT INTO users (tg_id, name, role, active, created_at) " +
  `VALUES ('${tgId}', 'Власник', 'owner', 1, '${new Date().toISOString()}') ` +
  "ON CONFLICT(tg_id) DO UPDATE SET role = 'owner', active = 1";

/* execSync із рядком, а не spawnSync із масивом, — і це не лінь.
   `npx` на Windows — це `npx.cmd`, тож spawnSync із `shell: false` дає
   ENOENT, а з `shell: true` cmd.exe розбирає рядок по-своєму й ріже SQL
   по пробілах на окремі аргументи. Один рядок через оболонку — єдиний
   варіант, який працює і там, і в Git Bash.

   Лапки в SQL навмисно не екрануємо: таке екранування було б хибним
   відчуттям захисту — `$`, зворотні лапки й `%` оболонка все одно
   розгорне, і наступний, хто подасть сюди довільний текст, на цьому
   зловиться. Безпечно тут лише одне: у рядок потрапляє рівно `tgId`,
   який вище перевірено на `/^[0-9]+$/`, і дата з toISOString(). Жодного
   зовнішнього тексту в SQL немає, і додавати його без іншого способу
   виклику не можна. */
const cmd = remote
  ? `npx wrangler d1 execute leads --remote --command "${sql}"`
  : `npx wrangler d1 execute DB --local --persist-to .wrangler/state -c wrangler.local.toml --command "${sql}"`;

try {
  execSync(cmd, { stdio: 'inherit' });
} catch {
  die('Не вдалося виконати запит до бази.');
}

console.log(`\n✓  Власника заведено (tg_id ${tgId}, роль owner).\n`);
