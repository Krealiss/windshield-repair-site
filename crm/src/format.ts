import { kyivShort } from '../../shared/card';

/** Копійки в базі → «1 200 ₴» для людини. Єдине місце перетворення */
export function money(kop: number | null | undefined): string {
  if (kop === null || kop === undefined) return '';
  const uah = Math.round(kop / 100);
  return `${uah.toLocaleString('uk-UA')} ₴`;
}

/** Копійки з поля форми: «1200» або «1200,50» → 120000 */
export function toKop(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  const kop = Math.round(value * 100);
  // Поза безпечними цілими сума перестала б бути точною копійкою
  return Number.isSafeInteger(kop) ? kop : null;
}

export const dateTime = (iso: string | null | undefined) => (iso ? kyivShort(iso) : '');

/** Скільки мілісекунд київський час випереджає UTC у даний момент */
function kyivOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * «2026-09-30T14:00» із поля datetime-local → ISO у UTC.
 *
 * Поле віддає час без пояса, і це час оператора, тобто київський.
 * `new Date(value)` у Worker читав б його як UTC (там завжди UTC), і
 * запис на 14:00 показувався б о 16:00 або 17:00. Зсув залежить від
 * літнього часу, тож рахуємо його для самого моменту, і то двічі:
 * перший прохід міг потрапити по інший бік переходу.
 */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const naive = Date.parse(`${value}Z`);
  if (Number.isNaN(naive)) return null;

  let instant = naive - kyivOffsetMs(naive);
  instant = naive - kyivOffsetMs(instant);
  return new Date(instant).toISOString();
}

const STATUS_LABEL: Record<string, string> = {
  new: '🆕 Нова',
  in_work: '🔧 В роботі',
  done: '✅ Виконана',
  declined: '✖️ Відмова',
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
