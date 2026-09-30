import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';
import { REASONS } from '../../../shared/card';

export function leadPage(lead: LeadFull, history: LeadFull[], viewer: Viewer) {
  const notes = (lead.notes ?? '').split('\n').filter((n) => n.trim());

  /* Дії показуємо лише там, де вони щось змінять. Повторна зміна в той
     самий стан нічого не переписує (так і задумано), тож форма
     «Виконано» на виконаній заявці мовчки нічого б не робила. «Повернути»
     є лише у фінальних станах — як у боті. */
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
      ${lead.status === 'done' && lead.closed_at
        ? html`<p>Закрито ${dateTime(lead.closed_at)} на ${money(lead.amount)}.
            ${lead.work_note ?? ''}</p>`
        : ''}

      ${isFinal
        ? ''
        : html`<h2>Запис на час</h2>
            <form method="post" action="/lead/${lead.id}/appoint">
              <input type="datetime-local" name="appointment_at" required />
              <button type="submit">Записати</button>
            </form>`}

      ${lead.status === 'done'
        ? ''
        : html`<h2>Закрити роботу</h2>
            <form method="post" action="/lead/${lead.id}/close">
              <label>Сума, ₴ <input name="amount" inputmode="decimal" required /></label>
              <label>Що зробили <textarea name="work_note" rows="2"></textarea></label>
              <button type="submit">Виконано</button>
            </form>`}

      ${lead.status === 'declined'
        ? ''
        : html`<h2>Відмова</h2>
            <form method="post" action="/lead/${lead.id}/decline">
              <select name="reason">
                ${REASONS.map((r) => html`<option value="${r}">${r}</option>`)}
                <option value="">Інша причина</option>
              </select>
              <input name="other" placeholder="Своя причина" />
              <button type="submit">Відмовити</button>
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
