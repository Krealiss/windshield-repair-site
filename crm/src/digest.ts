/**
 * Ранкова зведення в групу: хто записаний на сьогодні й що лежить без руху.
 *
 * Навіщо. Запис на час у заявці є, сторінка «Сьогодні» є — але вони
 * мовчать, поки в них не зайдеш. Людина в боксі в CRM не заглядає, вона
 * дивиться в телефон, коли той пискнув. Одне повідомлення о восьмій
 * робить розпис тим, що приходить саме, а не тим, що треба не забути
 * відкрити.
 *
 * Зведення нічого не міняє: ні кнопок, ні станів. Стан заявки
 * міняється в її власній картці — інакше зʼявилося б друге місце, де
 * можна натиснути, і два місця неминуче розійшлися б.
 */
import type { Env } from './env';
import { listDay, staleNewCount, type LeadFull } from './db';
import { kyivDayBounds, kyivTime } from './format';
import { call, telegramApi } from '../../shared/notify';

/** Заявка «залежалась», якщо її ніхто не взяв за добу */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Текст зведення — або null, якщо казати нема чого.
 *
 * Мовчання навмисне. Щоденне «сьогодні записів немає» привчає не
 * читати повідомлення взагалі, і тоді пропустять те, яке мало значення.
 *
 * Функція чиста: ні бази, ні мережі. Її можна прогнати на вигаданих
 * рядках і побачити кожен випадок — для проєкту без тестового раннера
 * це єдиний спосіб перевірити текст, не надсилаючи нічого в Telegram.
 */
export function digestText(day: LeadFull[], stale: number, crmUrl?: string): string | null {
  if (day.length === 0 && stale === 0) return null;

  const lines: string[] = ['🌅 Сьогодні'];

  if (day.length === 0) {
    lines.push('', 'Записів немає.');
  } else {
    lines.push('');
    for (const r of day) {
      // Час — спереду й окремо: у розписі очима шукають саме його
      const time = r.appointment_at ? kyivTime(r.appointment_at) : '--:--';
      const about = [r.car, r.assignee_name && `майстер: ${r.assignee_name}`]
        .filter(Boolean)
        .join(' · ');
      lines.push(`${time} — ${r.name}, ${r.phone}${about ? ` · ${about}` : ''}`);
    }
  }

  if (stale > 0) {
    lines.push('', `${stale} ${pluralLeads(stale)} без руху більше доби.`);
    if (crmUrl) lines.push(crmUrl);
  }

  return lines.join('\n');
}

/**
 * «1 нова заявка», «2 нові заявки», «5 нових заявок».
 *
 * Українська має три форми, і підставити скрізь одну — зробити
 * повідомлення, яке читається як машинне. Правило те саме, що для
 * решти слов'янських: 11-14 завжди третя форма, далі вирішує остання
 * цифра.
 */
function pluralLeads(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'нових заявок';
  if (mod10 === 1) return 'нова заявка';
  if (mod10 >= 2 && mod10 <= 4) return 'нові заявки';
  return 'нових заявок';
}

/**
 * Зібрати й надіслати. Викликається з cron-обробника.
 *
 * Без адресата або токена виходимо мовчки — те саме правило, що в
 * решті коду: без секретів нічого не робимо. Помилку Telegram пишемо
 * в журнал воркера (observability увімкнено в wrangler.toml) і
 * виходимо: cron не повторює, а наступного ранку спроба буде нова.
 */
export async function sendDigest(env: Env): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId || !env.TELEGRAM_BOT_TOKEN) return;

  const { from, to } = kyivDayBounds();
  const [day, stale] = await Promise.all([
    listDay(env.DB, from, to),
    staleNewCount(env.DB, new Date(Date.now() - STALE_MS).toISOString()),
  ]);

  const text = digestText(day, stale, env.CRM_URL);
  if (!text) return;

  const res = await call(telegramApi(env.TELEGRAM_BOT_TOKEN), 'sendMessage', {
    chat_id: chatId,
    text,
  });

  if (!res.ok) {
    // Без тіла відповіді: у ній буває текст повідомлення, тобто дані клієнтів
    console.error(`crm: ранкове зведення не надіслано, Telegram відповів ${res.status}`);
  }
}
