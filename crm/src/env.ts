/**
 * Привʼязки Worker. Окремим файлом, а не в index.ts: цей тип потрібен
 * і модулям, які index імпортує (наприклад sync.ts), а імпорт типу з
 * index створив би коло.
 */
export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  /* Запасний адресат, якщо в заявці не збереглося chat_id. Знак
     питання навмисно — забута змінна не має валити застосунок */
  TELEGRAM_CHAT_ID?: string;
  SESSION_SECRET: string;
}
