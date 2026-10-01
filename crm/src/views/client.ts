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
 *
 * Звернення показані картками: у таблиці з пʼяти колонок на телефоні
 * нотатка про роботу обрізалася б першою, хоч саме вона й пояснює, що
 * з цією машиною вже робили.
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

      <a class="btn btn--primary btn--wide" href="tel:${phone}">📞 ${phone}</a>

      <p class="muted">
        Звернень: ${rows.length}${cars.length ? html` · ${cars.join(', ')}` : ''}
        ${paid.length ? html`<br />Разом сплачено: <strong>${money(total)}</strong>` : ''}
      </p>

      <h2>Звернення</h2>
      ${rows.map((r) => {
        const work = workCell(r);
        return html`<a class="card" href="/lead/${r.id}">
          <div class="card__top">
            <span class="chip">${statusLabel(r.status)}</span>
            <span class="num">#${r.id}</span>
          </div>
          <div class="card__meta">
            ${dateTime(r.created_at)}${r.status === 'done' && r.amount !== null
              ? html` · <strong>${money(r.amount)}</strong>`
              : ''}
            ${work ? html`<br />${work}` : ''}
          </div>
        </a>`;
      })}`,
    viewer
  );
}
