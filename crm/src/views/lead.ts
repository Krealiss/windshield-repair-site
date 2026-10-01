import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';
import { REASONS } from '../../../shared/card';

export function leadPage(lead: LeadFull, history: LeadFull[], viewer: Viewer) {
  const notes = (lead.notes ?? '').split('\n').filter((n) => n.trim());

  /* Кнопки — ті самі переходи, що й у боті. З фінального стану є єдиний
     вихід, «Повернути»: прямі done↔declined ламали б інваріант, на якому
     тримається бот (prev_status ніколи не фінальний), і заявка
     замикалася б між двома фіналами.

     На виконаній і відмовленій заявці форми лишаються, але вже як
     уточнення: сума для заявки, закритої кнопкою в боті, і причина для
     відмови без причини. Вони пишуть поля, а не переходять у стан. */
  const isFinal = lead.status === 'done' || lead.status === 'declined';

  return layout(
    `Заявка #${lead.id}`,
    html`<h1>Заявка #${lead.id} · ${statusLabel(lead.status)}</h1>

      <p>
        <strong>${lead.name}</strong><br />
        <a href="/client/${encodeURIComponent(lead.phone)}">${lead.phone}</a><br />
        <span class="muted">${[lead.age, lead.car].filter(Boolean).join(' · ')}</span>
      </p>

      <p class="muted">Прийшла: ${dateTime(lead.created_at)}${
        lead.actor_name ? html` · взяв: ${lead.actor_name}` : ''
      }</p>

      ${notes.map((n) => html`<p><strong>${n}</strong></p>`)}
      ${lead.appointment_at ? html`<p>Записано на: ${dateTime(lead.appointment_at)}</p>` : ''}
      ${lead.status === 'declined' && lead.decline_reason
        ? html`<p>Причина відмови: ${lead.decline_reason}</p>`
        : ''}
      ${lead.status === 'done'
        ? lead.amount !== null
          ? html`<p>Закрито${lead.closed_at ? html` ${dateTime(lead.closed_at)}` : ''} на
              ${money(lead.amount)}. ${lead.work_note ?? ''}</p>`
          : html`<p><strong>Виконана, але суму не вказано</strong> (закрита кнопкою в
              боті). ${lead.work_note ?? ''}</p>`
        : ''}

      ${isFinal
        ? ''
        : html`<h2>Запис на час</h2>
            <form method="post" action="/lead/${lead.id}/appoint">
              <input type="datetime-local" name="appointment_at" required />
              <button type="submit">${lead.appointment_at ? 'Перезаписати' : 'Записати'}</button>
            </form>
            ${lead.appointment_at
              ? html`<!-- Окрема форма, а не порожнє поле вище: порожнім
                         значенням запис не стирається навмисно, інакше
                         недонабраний час зносив би наявний. Клієнт
                         скасував — заявка зникає зі «Сьогодні» й
                         лишається в роботі. -->
                  <form method="post" action="/lead/${lead.id}/unappoint">
                    <button type="submit">Скасувати запис</button>
                  </form>`
              : ''}`}

      ${lead.status === 'declined'
        ? ''
        : html`<h2>${lead.status === 'done' ? 'Уточнити суму' : 'Закрити роботу'}</h2>
            <form method="post" action="/lead/${lead.id}/close">
              <label>Сума, ₴ <input name="amount" inputmode="decimal" required /></label>
              <label>Що зробили
                <textarea name="work_note" rows="2">${lead.status === 'done' ? (lead.work_note ?? '') : ''}</textarea>
              </label>
              <button type="submit">${lead.status === 'done' ? 'Зберегти' : 'Виконано'}</button>
            </form>`}

      ${lead.status === 'done'
        ? ''
        : html`<h2>${lead.status === 'declined' ? 'Причина відмови' : 'Відмова'}</h2>
            <form method="post" action="/lead/${lead.id}/decline">
              <!-- Перший пункт — порожній і типово обраний. Без нього
                   <select> надсилав би REASONS[0] («Тріщина завелика —
                   тільки заміна»), і один клік «Відмовити» записував би
                   технічний діагноз як факт. Бот у цій ситуації лишає
                   NULL, і звіт про втрачених клієнтів бачить різницю між
                   «причини немає» і вигаданою причиною. -->
              <select name="reason">
                <option value="">— без причини —</option>
                ${REASONS.map((r) => html`<option value="${r}">${r}</option>`)}
              </select>
              <input name="other" placeholder="Своя причина" />
              <button type="submit">${lead.status === 'declined' ? 'Зберегти' : 'Відмовити'}</button>
            </form>`}

      ${isFinal
        ? html`<form method="post" action="/lead/${lead.id}/undo">
            <button type="submit">↩️ Повернути</button>
          </form>`
        : ''}

      <h2>Звернення з цього номера</h2>
      <table>
        <tbody>
          ${history.map(
            (h) => html`<tr>
              <td><a href="/lead/${h.id}">#${h.id}</a></td>
              <td>${dateTime(h.created_at)}</td>
              <td>${statusLabel(h.status)}</td>
              <td>${h.status === 'done' ? money(h.amount) : ''}</td>
            </tr>`
          )}
        </tbody>
      </table>`,
    viewer
  );
}
