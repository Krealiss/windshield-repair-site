/**
 * Текст картки заявки і кнопки під нею.
 *
 * Один модуль на двох споживачів: /api/lead малює картку вперше,
 * /api/tg перемальовує її після зміни стану. Дві копії цього коду
 * розійшлися б на першій же правці тексту — у цьому проєкті таке
 * вже траплялося з іконками соцмереж.
 *
 * Тека починається з підкреслення: Cloudflare Pages не робить із
 * таких файлів маршрутів, тож модуль лишається внутрішнім.
 */

/**
 * Приводить текст із форми (або будь-яке інше зовнішнє значення,
 * наприклад імʼя з Telegram) до вигляду, придатного для повідомлення.
 *
 * Будь-який пробільний символ — зокрема перенос рядка — стає звичайним
 * пробілом. Це не косметика: повідомлення в Telegram складається з
 * рядків «Поле: значення», і значення з переносом усередині дописало б у
 * заявку зайвий рядок, який виглядає як справжнє поле. Наприклад,
 * чужий номер телефона.
 *
 * \s у JS НЕ покриває NEL (U+0085), хоча за UAX #14 це обов'язковий
 * розрив рядка для рушіїв розкладки на базі Qt (Telegram Desktop) і
 * для Android/iOS: `\s` в ECMAScript — це фіксований список кодових
 * точок (WhiteSpace + LineTerminator), а не Unicode-властивість
 * White_Space, у яку U+0085 входить. Тому клас нижче додає його явно —
 * перевірено в Node на LF, CR, VT, FF, TAB, U+2028, U+2029, NBSP і
 * U+0085 (звіт правки: final-fix-report.md, знахідка 2).
 *
 * Довжина обрізається, бо підпис до фотографії в Telegram обмежений
 * 1024 символами, і заявка, яка через довге поле не надіслалась,
 * гірша за обрізане ім'я.
 */
export function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .split(/[\s\u0085]+/)
    .join(' ')
    .trim()
    .slice(0, max);
}

export type Status = 'new' | 'in_work' | 'done' | 'declined';

export interface LeadRow {
  id: number;
  created_at: string;
  name: string;
  phone: string;
  age?: string | null;
  car?: string | null;
  photos: number;
  status: Status;
  prev_status?: Status | null;
  actor_name?: string | null;
}

const MARK: Record<Status, string> = {
  new: '🆕',
  in_work: '🔧',
  done: '✅',
  declined: '✖️',
};

const TITLE: Record<Status, string> = {
  new: 'Нова',
  in_work: 'В роботі',
  done: 'Виконана',
  declined: 'Відмова',
};

/** «28.09, 13:20» за київським часом із UTC-мітки в базі */
export function kyivShort(iso: string): string {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('day')}.${v('month')}, ${v('hour')}:${v('minute')}`;
}

/** «12.09» — для рядка про попереднє звернення */
export function kyivDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('day')}.${v('month')}`;
}

/**
 * Текст картки.
 *
 * notes — рядки-попередження, які додаються перед часом: про попереднє
 * звернення з того самого номера або про те, що заявку не збережено.
 *
 * id = 0 означає, що рядка в базі немає: номер у заголовку не
 * показуємо, бо його не існує.
 */
export function cardText(lead: LeadRow, notes: string[] = []): string {
  const head = lead.id > 0 ? `Заявка #${lead.id}` : 'Заявка';
  const lines = [`${MARK[lead.status]} ${head} · ${TITLE[lead.status]}`, ''];

  lines.push(lead.name, lead.phone);

  // Давність і авто — одна думка про машину, тож один рядок.
  // Порожні не згадуються взагалі.
  const about = [lead.age, lead.car].filter(Boolean).join(' · ');
  if (about) lines.push(about);

  // У новій заявці рядка немає: брати її ще ніхто не встиг
  if (lead.status !== 'new' && lead.actor_name) {
    lines.push('', `Взяв: ${lead.actor_name}`);
  }

  for (const note of notes) lines.push('', note);

  lines.push('', kyivShort(lead.created_at));
  return lines.join('\n');
}

/**
 * Кнопки залежать від стану. Фінальні лишають тільки «Повернути» —
 * без неї одне помилкове натискання назавжди заморожує заявку.
 *
 * callback_data обмежена 64 байтами, тож дія і номер, без тексту.
 */
export function keyboard(lead: LeadRow) {
  const btn = (text: string, action: string) => ({
    text,
    callback_data: `${action}:${lead.id}`,
  });

  const row =
    lead.status === 'new'
      ? [btn('🔧 В роботу', 'work'), btn('✖️ Відмова', 'decline')]
      : lead.status === 'in_work'
        ? [btn('✅ Виконано', 'done'), btn('✖️ Відмова', 'decline')]
        : [btn('↩️ Повернути', 'undo')];

  return { inline_keyboard: [row] };
}
