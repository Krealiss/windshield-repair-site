/**
 * Після будь-якої зміни стану картка в Telegram перемальовується —
 * інакше в чаті лишиться вчорашня правда, а в групі її бачить уся
 * команда.
 *
 * Помилка тут не валить дію: заявка в базі вже змінена, і втратити
 * зміну через недоступний Telegram гірше, ніж мати неперемальовану
 * картку.
 */
import { drawCard, telegramApi, type NotifyRow } from '../../shared/notify';
import type { Env } from './env';
import { getLead } from './db';

export async function syncCard(env: Env, id: number): Promise<void> {
  try {
    const row = await getLead(env.DB, id);
    if (!row) return;
    await drawCard(env.DB, telegramApi(env.TELEGRAM_BOT_TOKEN), env.TELEGRAM_CHAT_ID, row as NotifyRow);
  } catch (err) {
    /* Лише назва помилки: текст помилки fetch може містити адресу
       запиту, а в ній — токен бота, і потрапити в журнал він не
       повинен. */
    console.error('syncCard: картку не перемальовано', err instanceof Error ? err.name : 'unknown');
  }
}
