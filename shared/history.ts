/**
 * Історія звернень із того самого номера — для кнопки під карткою.
 *
 * Навіщо. Картка вже каже «цей номер уже звертався: 12.09», і на цьому
 * зупиняється: скільки разів, із чим і на скільки — невідомо, поки не
 * відкриєш CRM. А відкривати її посеред розмови з клієнтом ніхто не
 * буде. Кнопка відповідає на те саме питання там, де воно виникає.
 *
 * Список, а не підсумок: «5 звернень» нічого не каже, а «тричі ремонт і
 * двічі відмова через ціну» каже все. Подробиці — у CRM, тому рядок
 * короткий: дата, стан, сума.
 */
import { money } from './money';

export type HistoryRow = {
  id: number;
  created_at: string;
  status: string;
  amount: number | null;
};

/** Скільки звернень показуємо повністю. Решта — рядком «ще N раніше». */
const SHOWN = 10;

/* Дата з роком, на відміну від попередження в картці. Там дата одна й
   свіжа, а тут до десяти рядків за кілька років: два «10.06» поспіль
   без року не розрізнити. */
function kyivDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${v('day')}.${v('month')}.${v('year')}`;
}

const MARK: Record<string, string | undefined> = {
  new: '🆕',
  in_work: '🔧',
  done: '✅',
  declined: '✖️',
};

/**
 * Текст повідомлення з історією. Чиста функція: ні бази, ні мережі.
 *
 * `rows` — звернення з того самого номера, крім поточного, найновіші
 * зверху. Поточне не показуємо: воно й так над кнопкою.
 *
 * Підсумок рахує лише виконані заявки із сумою — те саме правило, що в
 * картці клієнта: «Повернути» не чистить суму, тож повернена чи
 * відмовлена заявка може тримати стару, і рахувати її означало б
 * завищувати дохід від клієнта.
 */
export function historyText(rows: HistoryRow[], crmUrl?: string, phone?: string): string {
  if (rows.length === 0) return 'Інших звернень із цього номера немає.';

  const lines = [`📋 Попередні звернення (${rows.length})`, ''];

  for (const r of rows.slice(0, SHOWN)) {
    const mark = MARK[r.status] ?? '❔';
    const sum = r.status === 'done' && r.amount !== null ? ` · ${money(r.amount)}` : '';
    lines.push(`${kyivDay(r.created_at)} ${mark} #${r.id}${sum}`);
  }

  if (rows.length > SHOWN) lines.push(`… ще ${rows.length - SHOWN} раніше`);

  /* Підсумок — за всі звернення, і це сказано вголос: видно десять
     рядків, а рахується більше, і без підпису число не звести з тим, що
     на екрані. Поточна заявка в підсумок не входить — вона над кнопкою,
     тому в CRM сума за цим номером буде більшою. */
  const paid = rows.filter((r) => r.status === 'done' && r.amount !== null);
  if (paid.length) {
    const total = paid.reduce((s, r) => s + (r.amount ?? 0), 0);
    const scope = rows.length > SHOWN ? ` за всі ${rows.length}` : '';
    lines.push('', `Разом сплачено${scope}: ${money(total)}`);
  }

  /* Посилання на картку клієнта — лише коли адресу CRM задано змінною
     оточення. У боті немає запиту, з якого можна дізнатися свій домен,
     а зашити чужий домен у код гірше, ніж не показати посилання. */
  if (crmUrl && phone) {
    lines.push('', `${crmUrl.replace(/\/+$/, '')}/client/${encodeURIComponent(phone)}`);
  }

  return lines.join('\n');
}
