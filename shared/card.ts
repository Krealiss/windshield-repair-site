/**
 * Текст картки заявки і кнопки під нею.
 *
 * Один модуль на трьох споживачів: `/api/lead` малює картку вперше,
 * `/api/tg` перемальовує її після натискання кнопки, а CRM (`crm/`) —
 * після дії оператора. Дві копії цього коду розійшлися б на першій же
 * правці тексту — у цьому проєкті таке вже траплялося з іконками
 * соцмереж.
 *
 * Тека `shared/` лежить поза `functions/`, тож Cloudflare Pages не
 * робить із цих файлів маршрутів, а окремий Worker CRM імпортує їх тим
 * самим відносним шляхом. Обидва збирачі вкладають модуль у свій бандл,
 * тобто він справді один на два розгортання.
 */

/**
 * Приводить текст із форми (або будь-яке інше зовнішнє значення,
 * наприклад імʼя з Telegram) до вигляду, придатного для повідомлення.
 *
 * Будь-який пробільний або керуючий символ стає звичайним
 * пробілом. Це не косметика: картка — це кілька рядків, де ім'я, номер
 * і «Взяв: …» стоять окремо. Значення з переносом усередині дописало б
 * у заявку рядок, який виглядає як справжні дані, — наприклад чужий
 * номер телефона під справжнім ім'ям.
 *
 * Клас зібраний із властивостей Unicode, а не з переліку символів:
 *   \p{White_Space} — усі пробільні за Unicode. Саме властивість, а не
 *     `\s`: `\s` в ECMAScript — це фіксований список кодових точок
 *     (WhiteSpace + LineTerminator), у який не входить NEL (U+0085),
 *     хоч за UAX #14 це обовʼязковий розрив рядка для рушіїв розкладки
 *     на базі Qt (Telegram Desktop) і для Android/iOS.
 *   \p{Cc} — керуючі C0/C1. За тим самим UAX #14 до обовʼязкових
 *     розривів належать і U+001C–U+001E, яких `\s` не бачить, і саме
 *     вони раніше пролізали в картку й у базу сирими байтами.
 *   \p{Cf} — форматні: bidi-накази (U+202E перевертає напрям решти
 *     рядка, і оператор прочитав би номер навпаки) та невидимі
 *     нульової ширини (U+200B).
 *
 * Довжина обрізається, бо підпис до фотографії в Telegram обмежений
 * 1024 символами, і заявка, яка через довге поле не надіслалась,
 * гірша за обрізане ім'я.
 */
export function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\p{White_Space}\p{Cc}\p{Cf}]+/gu, ' ')
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
  decline_reason?: string | null;
}

/* Ключ — рядок, а не Status: стан приходить із бази, і наступна
   міграція, яка додасть стан (наприклад «Причина відмови»), інакше
   дала б картку зі словом undefined у заголовку. Тому в cardText()
   є запасні значення. */
/**
 * Готові причини відмови.
 *
 * Порядок важливий: у callback_data їде індекс, а не текст, бо 64 байти
 * на всю строку не вміщають фразу кириличними. Тому рядки можна
 * переписувати, але не переставляти й не видаляти з середини — картка,
 * надіслана старшим кодом, підставить причину за старим номером.
 * Додавати — тільки в кінець.
 */
export const REASONS = [
  'Тріщина завелика — тільки заміна',
  'Не влаштувала ціна',
  'Передумав',
  'Не додзвонились',
];

const MARK: Record<string, string | undefined> = {
  new: '🆕',
  in_work: '🔧',
  done: '✅',
  declined: '✖️',
};

const TITLE: Record<string, string | undefined> = {
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
  // Невідомий стан не має ламати картку: краще показати сире значення
  // з бази, ніж «undefined Заявка #7 · undefined»
  const mark = MARK[lead.status] ?? '❔';
  const title = TITLE[lead.status] ?? lead.status;
  const lines = [`${mark} ${head} · ${title}`, ''];

  lines.push(lead.name, lead.phone);

  // Давність і авто — одна думка про машину, тож один рядок.
  // Порожні не згадуються взагалі.
  const about = [lead.age, lead.car].filter(Boolean).join(' · ');
  if (about) lines.push(about);

  // У новій заявці рядка немає: брати її ще ніхто не встиг
  if (lead.status !== 'new' && lead.actor_name) {
    lines.push('', `Взяв: ${lead.actor_name}`);
  }

  // Причина — лише у відмові: у решті станів колонка порожня, а після
  // «Повернути» очищається, бо повернення означає, що відмова була
  // помилкою
  if (lead.status === 'declined' && lead.decline_reason) {
    lines.push('', `Причина: ${lead.decline_reason}`);
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

  const undo = btn('↩️ Повернути', 'undo');

  if (lead.status === 'new') {
    return { inline_keyboard: [[btn('🔧 В роботу', 'work'), btn('✖️ Відмова', 'decline')]] };
  }

  if (lead.status === 'in_work') {
    return { inline_keyboard: [[btn('✅ Виконано', 'done'), btn('✖️ Відмова', 'decline')]] };
  }

  /* Свіжа відмова питає причину. Питаємо після зміни стану, а не до:
     заявка вже відмовлена, і якщо оператора відвернули, вона не висить
     у невизначеності. Причина необовʼязкова — не натиснули, і нехай.

     Щойно причина є, кнопки зникають: переписувати її нема потреби, а
     «Повернути» все одно поруч і все одно її очистить. */
  if (lead.status === 'declined' && !lead.decline_reason) {
    return {
      inline_keyboard: [
        ...REASONS.map((text, i) => [btn(text, `r${i}`)]),
        [btn('✍️ Інша причина', 'rx'), undo],
      ],
    };
  }

  return { inline_keyboard: [[undo]] };
}
