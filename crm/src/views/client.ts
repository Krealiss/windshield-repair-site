import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';

/**
 * Клієнт — це представлення за номером телефона, а не окрема таблиця.
 * Сутність зʼявиться, коли буде що зберігати понад заявки.
 */
export function clientPage(phone: string, rows: LeadFull[], viewer: Viewer) {
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const cars = [...new Set(rows.map((r) => r.car).filter(Boolean))];
  const name = rows[0]?.name ?? '';

  return layout(
    phone,
    html`<h1>${name}</h1>
      <p><a href="tel:${phone}">${phone}</a></p>
      <p class="muted">
        Звернень: ${rows.length}${cars.length ? html` · ${cars.join(', ')}` : ''}${
          total ? html` · разом ${money(total)}` : ''
        }
      </p>

      <table>
        <thead>
          <tr><th>#</th><th>Коли</th><th>Стан</th><th>Сума</th><th>Робота</th></tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) => html`<tr>
              <td><a href="/lead/${r.id}">#${r.id}</a></td>
              <td>${dateTime(r.created_at)}</td>
              <td>${statusLabel(r.status)}</td>
              <td>${money(r.amount)}</td>
              <td>${r.work_note ?? r.decline_reason ?? ''}</td>
            </tr>`
          )}
        </tbody>
      </table>`,
    viewer
  );
}
