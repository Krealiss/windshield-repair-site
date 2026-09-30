import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type Viewer = { tg_id: string; name: string; role: string };

/* Стилі свої, а не з сайту: CRM — окремий застосунок, і бюджет
   швидкості сайту на неї не поширюється. Тримаємо мінімум. */
const STYLE = `
  :root { color-scheme: light dark; --line: #d8dbe0; --muted: #6b7280; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  header { display: flex; gap: 1rem; align-items: center;
           padding: .75rem 1rem; border-bottom: 1px solid var(--line); }
  header a { text-decoration: none; }
  main { padding: 1rem; max-width: 60rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid var(--line); }
  .muted { color: var(--muted); }
  form.inline { display: inline; }
  input, select, textarea, button { font: inherit; padding: .4rem; }
  label { display: block; margin: .6rem 0; }
`;

/* Тип тіла — саме той, що повертає тег `html` Hono: за наявності
   асинхронних вставок він віддає проміс, і вужчий тип змусив би
   приводити кожен виклик */
type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

export function layout(title: string, body: Body, viewer?: Viewer) {
  return html`<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${title} — CRM Avtoskloua</title>
    <style>${raw(STYLE)}</style>
  </head>
  <body>
    ${viewer
      ? html`<header>
          <a href="/">Заявки</a>
          <a href="/today">Сьогодні</a>
          <span class="muted">${viewer.name}</span>
          <form method="post" action="/logout" class="inline">
            <button type="submit">Вийти</button>
          </form>
        </header>`
      : ''}
    <main>${body}</main>
  </body>
</html>`;
}
