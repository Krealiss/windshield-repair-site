import { html, raw } from 'hono/html';
import { layout } from './layout';

/**
 * Віджет Telegram вимагає, щоб домен був привʼязаний до бота через
 * /setdomain у BotFather. Поки бойового домену немає, підходить адреса
 * *.workers.dev — її теж треба привʼязати.
 */
export function loginPage(botName: string, error?: string) {
  return layout(
    'Вхід',
    html`<h1 style="margin-top: 2rem">CRM Avtoskloua</h1>
      ${error ? html`<p class="warn">${error}</p>` : ''}
      <p class="muted">Вхід лише для власника.</p>
      ${raw(`<script async src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login="${botName}"
        data-size="large"
        data-auth-url="/auth"
        data-request-access="write"></script>`)}
      <!-- Посилання на довідку саме тут: майстер, який спробує зайти в
           CRM і отримає відмову, лишається на цій сторінці — і звідси ж
           може прочитати, що робити кнопками в групі -->
      <p class="muted" style="margin-top: 2rem">
        <a href="/dovidka">Як користуватися системою</a>
      </p>`
  );
}
