import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, statusLabel } from '../format';

export function todayPage(rows: LeadFull[], viewer: Viewer) {
  return layout(
    'Сьогодні',
    html`<h1>Сьогодні</h1>
      ${rows.length === 0
        ? html`<p class="muted">На сьогодні нікого не записано.</p>`
        : html`<table>
            <tbody>
              ${rows.map(
                (r) => html`<tr>
                  <td>${dateTime(r.appointment_at)}</td>
                  <td><a href="/lead/${r.id}">#${r.id}</a> ${r.name}</td>
                  <td>${r.phone}</td>
                  <td>${r.car ?? ''}</td>
                  <td>${statusLabel(r.status)}</td>
                </tr>`
              )}
            </tbody>
          </table>`}`,
    viewer
  );
}
