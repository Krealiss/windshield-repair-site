import { html } from 'hono/html';
import { layout, type Viewer } from './layout';

/** Ті самі варіанти, що й у формі на сайті: інакше два джерела заявок
    писали б у ту саму колонку різними словами, і звіт їх не склав би */
const AGES = ['До 2 днів', 'Тиждень', 'Більше тижня'];

/**
 * Заявка зі слів клієнта, який подзвонив.
 *
 * Поля ті самі, що й на сайті, плюс час запису: оператор розмовляє з
 * людиною просто зараз, і домовитись про час — природна частина тієї
 * самої розмови, а не окремий крок після.
 *
 * Обовʼязкові лише імʼя й телефон — як і на сайті. Марка й давність
 * корисні, але людина на тому кінці може їх не знати, і змушувати
 * оператора вигадувати гірше, ніж лишити порожнім.
 */
export function newLeadPage(viewer: Viewer, error?: string, form?: Record<string, string>) {
  const v = (k: string) => form?.[k] ?? '';

  return layout(
    'Нова заявка',
    html`<h1>Нова заявка</h1>
      <p class="muted">Клієнт подзвонив — запишіть його тут.</p>

      ${error ? html`<p class="warn">${error}</p>` : ''}

      <form method="post" action="/new">
        <label for="name">Імʼя</label>
        <input id="name" name="name" value="${v('name')}" required autocomplete="off" />

        <label for="phone">Телефон</label>
        <input
          id="phone"
          name="phone"
          value="${v('phone')}"
          inputmode="tel"
          placeholder="067 123 45 67"
          required
        />

        <label for="car">Марка авто</label>
        <input id="car" name="car" value="${v('car')}" autocomplete="off" />

        <label for="age">Давність скола</label>
        <select id="age" name="age">
          <option value="">— не питали —</option>
          ${AGES.map((a) => html`<option value="${a}" ${v('age') === a ? 'selected' : ''}>${a}</option>`)}
        </select>

        <label for="appointment_at">Записати на час</label>
        <input id="appointment_at" name="appointment_at" type="datetime-local" value="${v('appointment_at')}" />

        <button type="submit" class="btn btn--primary btn--wide" style="margin-top:.8rem">
          Створити заявку
        </button>
      </form>

      <p class="muted">
        Картка одразу піде в групу — майстри побачать її так само, як заявку з сайту.
      </p>`,
    viewer,
    'new'
  );
}
