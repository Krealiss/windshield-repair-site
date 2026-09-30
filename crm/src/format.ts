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
  return Math.round(value * 100);
}

export const dateTime = (iso: string | null | undefined) => (iso ? kyivShort(iso) : '');

/** «2026-09-30T14:00» із поля datetime-local → ISO у UTC */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const STATUS_LABEL: Record<string, string> = {
  new: '🆕 Нова',
  in_work: '🔧 В роботі',
  done: '✅ Виконана',
  declined: '✖️ Відмова',
};

export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
