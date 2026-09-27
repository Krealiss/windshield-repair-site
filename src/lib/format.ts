/** Форматування для показу. Дані в контенті лишаються «сирими». */

/** +380671234567 → +380 67 123 45 67 */
export function formatPhone(raw: string): string {
  const m = raw.match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : raw;
}

/** Для href="tel:" — без пробілів */
export const telHref = (raw: string) => `tel:${raw}`;

/** viber://chat потребує номер без плюса */
export const viberHref = (raw: string) => `viber://chat?number=${raw.replace('+', '')}`;

export const telegramHref = (nick: string) => `https://t.me/${nick.replace('@', '')}`;

const DAMAGE_LABELS: Record<string, string> = {
  star: 'Зіркоподібний скол',
  bullseye: 'Бичаче око',
  combo: 'Комбінований скол',
  crack: 'Тріщина',
};

/** «Зіркоподібний скол 15 мм · 35 хв» */
export function galleryCaption(type: string, mm: number, minutes?: number): string {
  const base = `${DAMAGE_LABELS[type] ?? 'Пошкодження'} ${mm} мм`;
  return minutes ? `${base} · ${minutes} хв` : base;
}

/** Час роботи для мікророзмітки: «9:00» → «09:00» */
export const padTime = (t: string) => (t.length === 4 ? `0${t}` : t);
