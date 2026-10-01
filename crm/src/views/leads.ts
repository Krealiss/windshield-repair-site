import { html, raw } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, statusLabel } from '../format';

export type ListFilter = { q: string; status: string; from: string; to: string };

/**
 * Список заявок — картками, а не таблицею.
 *
 * Таблиця з пʼяти колонок на телефоні не вміщається: правий край просто
 * обрізається, і «Авто» з «Записом» оператор не бачить узагалі. Картка
 * показує те саме, але згори вниз.
 *
 * Уся картка — посилання на заявку, а кнопка дзвінка винесена окремо:
 * подзвонити клієнту хочеться частіше, ніж читати подробиці, і це не
 * має коштувати двох переходів.
 */
export function leadsPage(rows: LeadFull[], filter: ListFilter, viewer: Viewer) {
  const narrowed = Boolean(filter.status || filter.from || filter.to);

  return layout(
    'Заявки',
    html`<h1>Заявки</h1>

      <!-- Фільтри згорнуті: CRM відкривають, щоб побачити заявки, а не
           щоб фільтрувати. Розгорнуті лише тоді, коли фільтр уже
           застосований — інакше незрозуміло, чому список виглядає дивно. -->
      <form method="get" action="/">
        <div class="row">
          <input
            type="search"
            name="q"
            value="${filter.q}"
            placeholder="Номер або імʼя"
            style="flex: 3 1 10rem"
          />
          <button type="submit" class="btn btn--primary" style="flex: 1 1 6rem">Шукати</button>
        </div>
        <details ${narrowed ? raw('open') : ''}>
          <summary class="muted" style="padding: .5rem 0; cursor: pointer">Фільтри</summary>
          <select name="status" aria-label="Стан">
            <option value="" ${filter.status === '' ? 'selected' : ''}>Активні</option>
            <option value="new" ${filter.status === 'new' ? 'selected' : ''}>Нові</option>
            <option value="in_work" ${filter.status === 'in_work' ? 'selected' : ''}>В роботі</option>
            <option value="done" ${filter.status === 'done' ? 'selected' : ''}>Виконані</option>
            <option value="declined" ${filter.status === 'declined' ? 'selected' : ''}>Відмови</option>
            <option value="all" ${filter.status === 'all' ? 'selected' : ''}>Усі</option>
          </select>
          <div class="row" style="margin-top: .5rem">
            <input type="date" name="from" value="${filter.from}" aria-label="Від дати" />
            <input type="date" name="to" value="${filter.to}" aria-label="До дати" />
          </div>
        </details>
      </form>

      ${rows.length === 0
        ? html`<p class="empty">Нічого не знайдено.</p>`
        : rows.map(
            (r) => html`<div class="card">
              <a class="card__top" href="/lead/${r.id}" style="text-decoration: none; color: inherit">
                <span class="chip">${statusLabel(r.status)}</span>
                <span class="num">#${r.id}</span>
              </a>
              <a href="/lead/${r.id}" style="text-decoration: none; color: inherit">
                <div class="card__name">${r.name}</div>
                <div class="card__meta">
                  ${[r.car, r.age].filter(Boolean).join(' · ')}
                  ${r.appointment_at ? html`<br />Запис: ${dateTime(r.appointment_at)}` : ''}
                </div>
              </a>
              <div class="row" style="margin-top: .6rem">
                <a class="btn" href="tel:${r.phone}">📞 ${r.phone}</a>
              </div>
            </div>`
          )}`,
    viewer,
    'leads'
  );
}
