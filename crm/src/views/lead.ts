import { html } from 'hono/html';
import { layout, type Viewer } from './layout';
import type { LeadFull } from '../db';
import { dateTime, money, statusLabel } from '../format';
import { REASONS } from '../../../shared/card';

/**
 * Картка заявки.
 *
 * Згори — дзвінок: у майстерні це дія, яку роблять найчастіше, і вона
 * не має виглядати як виноска дрібним шрифтом.
 *
 * Кнопки — ті самі переходи, що й у боті. З фінального стану є єдиний
 * вихід, «Повернути»: прямі done↔declined ламали б інваріант, на якому
 * тримається бот (prev_status ніколи не фінальний), і заявка
 * замикалася б між двома фіналами.
 *
 * На виконаній і відмовленій заявці форми лишаються, але вже як
 * уточнення: сума для заявки, закритої кнопкою в боті, і причина для
 * відмови без причини. Вони пишуть поля, а не переходять у стан.
 */
export function leadPage(lead: LeadFull, history: LeadFull[], viewer: Viewer) {
  const notes = (lead.notes ?? '').split('\n').filter((n) => n.trim());
  const isFinal = lead.status === 'done' || lead.status === 'declined';
  const about = [lead.car, lead.age].filter(Boolean).join(' · ');

  return layout(
    `Заявка #${lead.id}`,
    html`<div class="card__top">
        <span class="chip">${statusLabel(lead.status)}</span>
        <span class="num">#${lead.id}</span>
      </div>

      <h1>${lead.name}</h1>

      <a class="btn btn--primary btn--wide" href="tel:${lead.phone}">📞 ${lead.phone}</a>

      <p class="muted">
        ${about ? html`${about}<br />` : ''}
        Прийшла: ${dateTime(lead.created_at)}${lead.actor_name ? html` · взяв: ${lead.actor_name}` : ''}
      </p>

      ${notes.map((n) => html`<p class="warn">${n}</p>`)}

      ${lead.appointment_at
        ? html`<p class="panel"><strong>Записано на ${dateTime(lead.appointment_at)}</strong></p>`
        : ''}
      ${lead.status === 'declined' && lead.decline_reason
        ? html`<p class="panel">Причина відмови: <strong>${lead.decline_reason}</strong></p>`
        : ''}
      ${lead.status === 'done'
        ? lead.amount !== null
          ? html`<p class="panel">
              Закрито${lead.closed_at ? html` ${dateTime(lead.closed_at)}` : ''} на
              <strong>${money(lead.amount)}</strong>${lead.work_note ? html`<br />${lead.work_note}` : ''}
            </p>`
          : html`<p class="warn">
              Виконана, але суму не вказано — закрита кнопкою в боті.
              ${lead.work_note ?? ''}
            </p>`
        : ''}

      ${isFinal
        ? ''
        : lead.appointment_at
          ? html`<!-- Запис уже є: поле вибору часу згорнуте, бо
                      переносять рідше, ніж дивляться. «Скасувати» видно
                      одразу — саме його шукають, коли клієнт не приїде.

                      Скасування окремою формою, а не порожнім полем
                      вище: порожнім значенням запис не стирається
                      навмисно, інакше недонабраний час зносив би
                      наявний. Заявка зникає зі «Сьогодні» й лишається
                      в роботі. -->
              <details>
                <summary class="muted" style="padding: .5rem 0; cursor: pointer">
                  Перенести на інший час
                </summary>
                <form method="post" action="/lead/${lead.id}/appoint">
                  <input type="datetime-local" name="appointment_at" required aria-label="Дата й час" />
                  <button type="submit" class="btn btn--wide" style="margin-top:.5rem">
                    Перезаписати
                  </button>
                </form>
              </details>
              <form method="post" action="/lead/${lead.id}/unappoint">
                <button type="submit" class="btn btn--quiet btn--wide">Скасувати запис</button>
              </form>`
          : html`<h2>Запис на час</h2>
              <form method="post" action="/lead/${lead.id}/appoint">
                <input type="datetime-local" name="appointment_at" required aria-label="Дата й час" />
                <button type="submit" class="btn btn--wide" style="margin-top:.5rem">Записати</button>
              </form>`}

      ${lead.status === 'declined'
        ? ''
        : html`<h2>${lead.status === 'done' ? 'Уточнити суму' : 'Закрити роботу'}</h2>
            <form method="post" action="/lead/${lead.id}/close">
              <label for="amount">Сума, ₴</label>
              <input id="amount" name="amount" inputmode="decimal" required />
              <label for="work_note">Що зробили</label>
              <textarea id="work_note" name="work_note" rows="2">${lead.status === 'done' ? (lead.work_note ?? '') : ''}</textarea>
              <button type="submit" class="btn btn--primary btn--wide" style="margin-top:.6rem">
                ${lead.status === 'done' ? 'Зберегти' : 'Виконано'}
              </button>
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
              <select name="reason" aria-label="Причина">
                <option value="">— без причини —</option>
                ${REASONS.map((r) => html`<option value="${r}">${r}</option>`)}
              </select>
              <label for="other">Або своя причина</label>
              <input id="other" name="other" placeholder="Напишіть своїми словами" />
              <button type="submit" class="btn btn--danger btn--wide" style="margin-top:.6rem">
                ${lead.status === 'declined' ? 'Зберегти причину' : 'Відмовити'}
              </button>
            </form>`}

      ${isFinal
        ? html`<form method="post" action="/lead/${lead.id}/undo">
            <button type="submit" class="btn btn--wide">↩️ Повернути в роботу</button>
          </form>`
        : ''}

      ${history.length > 1
        ? html`<h2>Звернення з цього номера</h2>
            ${history.map(
              (h) => html`<a class="card" href="/lead/${h.id}">
                <div class="card__top">
                  <span class="chip">${statusLabel(h.status)}</span>
                  <span class="num">#${h.id}</span>
                </div>
                <div class="card__meta">
                  ${dateTime(h.created_at)}${h.status === 'done' && h.amount !== null
                    ? html` · <strong>${money(h.amount)}</strong>`
                    : ''}
                </div>
              </a>`
            )}
            <a class="btn btn--wide" href="/client/${encodeURIComponent(lead.phone)}">
              Картка клієнта
            </a>`
        : html`<a class="btn btn--wide" style="margin-top:1.5rem"
            href="/client/${encodeURIComponent(lead.phone)}">Картка клієнта</a>`}`,
    viewer
  );
}
