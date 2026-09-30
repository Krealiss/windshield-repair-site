import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, statusLabel } from '../format';

export type ListFilter = { q: string; status: string; from: string; to: string };

export function leadsPage(rows: LeadFull[], filter: ListFilter, viewer: Viewer) {
  return layout(
    'Заявки',
    html`<h1>Заявки</h1>

      <form method="get" action="/">
        <input type="search" name="q" value="${filter.q}" placeholder="Номер або імʼя" />
        <select name="status">
          <option value="" ${filter.status === '' ? 'selected' : ''}>Активні</option>
          <option value="new" ${filter.status === 'new' ? 'selected' : ''}>Нові</option>
          <option value="in_work" ${filter.status === 'in_work' ? 'selected' : ''}>В роботі</option>
          <option value="done" ${filter.status === 'done' ? 'selected' : ''}>Виконані</option>
          <option value="declined" ${filter.status === 'declined' ? 'selected' : ''}>Відмови</option>
          <option value="all" ${filter.status === 'all' ? 'selected' : ''}>Усі</option>
        </select>
        <input type="date" name="from" value="${filter.from}" aria-label="Від дати" />
        <input type="date" name="to" value="${filter.to}" aria-label="До дати" />
        <button type="submit">Шукати</button>
      </form>

      ${rows.length === 0
        ? html`<p class="muted">Нічого не знайдено.</p>`
        : html`<table>
            <thead>
              <tr><th>#</th><th>Клієнт</th><th>Стан</th><th>Запис</th><th>Авто</th></tr>
            </thead>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td><a href="/lead/${r.id}">${r.id}</a></td>
                  <td>
                    ${r.name}<br />
                    <a class="muted" href="/client/${encodeURIComponent(r.phone)}">${r.phone}</a>
                  </td>
                  <td>${statusLabel(r.status)}</td>
                  <td>${dateTime(r.appointment_at)}</td>
                  <td>${r.car ?? ''}</td>
                </tr>`
              )}
            </tbody>
          </table>`}`,
    viewer
  );
}
