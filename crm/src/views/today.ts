import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, statusLabel } from '../format';

/**
 * Список записаних на сьогодні.
 *
 * Час винесено вперед і великим: це єдине, за чим тут бігають очима.
 * Кнопка дзвінка поруч — клієнт, який не приїхав на свій час, це
 * найчастіша причина взяти телефон.
 */
export function todayPage(rows: LeadFull[], viewer: Viewer) {
  return layout(
    'Сьогодні',
    html`<h1>Сьогодні</h1>
      ${rows.length === 0
        ? html`<p class="empty">На сьогодні нікого не записано.</p>`
        : rows.map(
            (r) => html`<div class="card">
              <a href="/lead/${r.id}" style="text-decoration: none; color: inherit">
                <div class="card__top">
                  <span class="card__name">${dateTime(r.appointment_at)}</span>
                  <span class="chip">${statusLabel(r.status)}</span>
                  <span class="num">#${r.id}</span>
                </div>
                <div class="card__name">${r.name}</div>
                <div class="card__meta">${r.car ?? ''}</div>
              </a>
              <div class="row" style="margin-top: .6rem">
                <a class="btn" href="tel:${r.phone}">📞 ${r.phone}</a>
              </div>
            </div>`
          )}`,
    viewer,
    'today'
  );
}
