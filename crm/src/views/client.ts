import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';

/** Причина — для відмови, нотатка про роботу — лише для виконаної */
function workCell(r: LeadFull): string {
  if (r.status === 'declined') return r.decline_reason ?? '';
  if (r.status === 'done') return r.work_note ?? '';
  return '';
}

/**
 * Клієнт — це представлення за номером телефона, а не окрема таблиця.
 * Сутність зʼявиться, коли буде що зберігати понад заявки.
 */
export function clientPage(phone: string, rows: LeadFull[], viewer: Viewer) {
  /* Гроші дає лише виконана заявка. «Повернути» не чистить amount і
     work_note, тож повернена чи відмовлена заявка може тримати стару
     суму; рахувати її означало б завищувати дохід від клієнта. Окремо
     «є виконані із сумою» і «сума нуль»: гарантійний ремонт — це 0 ₴, а
     не «нічого». */
  const paid = rows.filter((r) => r.status === 'done' && r.amount !== null);
  const total = paid.reduce((s, r) => s + (r.amount ?? 0), 0);
  const cars = [...new Set(rows.map((r) => r.car).filter(Boolean))];
  const name = rows[0]?.name ?? '';

  return layout(
    phone,
    html`<h1>${name}</h1>
      <p><a href="tel:${phone}">${phone}</a></p>
      <p class="muted">
        Звернень: ${rows.length}${cars.length ? html` · ${cars.join(', ')}` : ''}${
          paid.length ? html` · разом ${money(total)}` : ''
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
              <td>${r.status === 'done' ? money(r.amount) : ''}</td>
              <td>${workCell(r)}</td>
            </tr>`
          )}
        </tbody>
      </table>`,
    viewer
  );
}
