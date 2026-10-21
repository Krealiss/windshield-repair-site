/**
 * Гроші: копійки в базі ↔ рядок для людини.
 *
 * Живе в `shared/`, бо потрібне і CRM, і картці в Telegram (shared/card.ts),
 * а `shared/` не має права імпортувати з `crm/`. `crm/src/format.ts`
 * реекспортує звідси обидві функції, щоб решта CRM лишилась без змін.
 */

/** Копійки в базі → «1 200 ₴» для людини. Єдине місце перетворення */
export function money(kop: number | null | undefined): string {
  if (kop === null || kop === undefined) return '';
  /* Копійки не округлюємо: оператор ввів 1200,50 і має побачити 1200,50.
     Цілі гривні без «,00», щоб звичайна сума не пестрила нулями. */
  const uah = Math.trunc(kop / 100);
  const k = Math.abs(kop % 100);
  const whole = uah.toLocaleString('uk-UA');
  return k ? `${whole},${String(k).padStart(2, '0')} ₴` : `${whole} ₴`;
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
