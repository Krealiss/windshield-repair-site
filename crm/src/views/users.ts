import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { UserRow } from '../../../shared/users';
import { dateTime } from '../format';

type Row = UserRow & { created_at: string };

/**
 * Хто має доступ.
 *
 * Майстри заводяться самі, коли вперше тиснуть кнопку в групі, тож цей
 * список здебільшого читають, а не наповнюють. Єдина дія — зняти або
 * повернути доступ.
 */
export function usersPage(rows: Row[], viewer: Viewer, error?: string) {
  return layout(
    'Люди',
    html`<h1>Люди</h1>
      ${error ? html`<p class="warn">${error}</p>` : ''}
      <p class="muted">
        Майстри зʼявляються тут самі, коли вперше натискають кнопку під карткою
        в групі. Знятий доступ діє негайно — і в боті, і тут.
      </p>

      ${rows.map(
        (r) => html`<div class="card">
          <div class="card__top">
            <span class="chip">${r.role === 'owner' ? 'Власник' : 'Майстер'}</span>
            ${r.active ? '' : html`<span class="chip">доступ знято</span>`}
          </div>
          <div class="card__name">${r.name}</div>
          <div class="card__meta">З ${dateTime(r.created_at)}</div>
          ${r.role === 'owner'
            ? html`<p class="muted" style="margin:.6rem 0 0">
                Власнику доступ не знімається: інакше в CRM не зайшов би ніхто.
              </p>`
            : html`<form method="post" action="/users/${r.tg_id}/active" style="margin-top:.6rem">
                <input type="hidden" name="active" value="${r.active ? '0' : '1'}" />
                <button type="submit" class="btn btn--wide ${r.active ? 'btn--danger' : ''}">
                  ${r.active ? 'Зняти доступ' : 'Повернути доступ'}
                </button>
              </form>`}
        </div>`
      )}`,
    viewer,
    'users'
  );
}
