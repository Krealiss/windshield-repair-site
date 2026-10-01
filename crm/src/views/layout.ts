import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export type Viewer = { tg_id: string; name: string; role: string };

/**
 * Стилі свої, а не з сайту: CRM — окремий застосунок, і бюджет швидкості
 * сайту на неї не поширюється.
 *
 * Розмітка розрахована на телефон як головний пристрій: власник і
 * майстри відкривають її в боксі, однією рукою, а не за ноутбуком. Тому
 * ніяких таблиць із колонками — картки в стовпчик, а дії завбільшки з
 * палець (44 пікселі — та межа, нижче якої промахуються).
 *
 * Шрифт системний, не той, що на сайті. Сайт може дозволити собі чекати
 * на шрифт із мережі, бо його читають один раз; робочий інструмент на
 * мобільному інтернеті в боксі — ні. Спільність із сайтом тримається на
 * кольорі й формі, а не на гарнітурі.
 *
 * Темна тема не «як вийде», а продумана: у боксі ввечері світлий екран
 * у вічі — не дрібниця.
 */
const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --surface: #f6f7f9;
    --ink: #11161f;
    --muted: #5b6472;
    --line: #e3e6eb;
    --accent: #1d4ed8;
    --accent-ink: #ffffff;
    --warn-bg: #fff4e5;
    --warn-ink: #7a4100;
    --danger: #b42318;
    --radius: 12px;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #10141b;
      --surface: #171d26;
      --ink: #e9edf3;
      --muted: #98a2b3;
      --line: #273041;
      --accent: #5b8cff;
      --accent-ink: #0b1220;
      --warn-bg: #2a2012;
      --warn-ink: #f0c38a;
      --danger: #ff6b5e;
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
  }

  /* Шапка липка: у довгому списку заявок перехід на «Сьогодні» має
     лишатися під рукою, а не десь угорі сторінки */
  header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: .25rem;
    padding: .5rem .75rem;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }
  header nav { display: flex; gap: .25rem; flex: 1; min-width: 0; }
  header a {
    color: var(--muted);
    text-decoration: none;
    padding: .5rem .7rem;
    border-radius: 999px;
    font-weight: 600;
  }
  header a[aria-current='page'] { color: var(--accent-ink); background: var(--accent); }

  main { padding: 1rem .75rem 3rem; max-width: 44rem; margin: 0 auto; }

  h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
  h2 { font-size: 1rem; margin: 1.5rem 0 .5rem; color: var(--muted); font-weight: 600; }
  p { margin: .5rem 0; }
  .muted { color: var(--muted); }

  /* ── Картка ───────────────────────────────────────────── */
  .card {
    display: block;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .85rem;
    margin-bottom: .6rem;
    color: inherit;
    text-decoration: none;
  }
  .card__top { display: flex; align-items: center; gap: .5rem; margin-bottom: .35rem; }
  .card__name { font-weight: 600; font-size: 1.05rem; }
  .card__meta { color: var(--muted); font-size: .9rem; }

  /* Значок стану. Емодзі лишаються ті самі, що в картці Telegram, —
     оператор бачить один словник у двох місцях */
  .chip {
    font-size: .8rem;
    font-weight: 600;
    padding: .15rem .5rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--bg);
    white-space: nowrap;
  }
  .num { color: var(--muted); font-size: .9rem; margin-left: auto; }

  /* ── Дії ──────────────────────────────────────────────── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: .4rem;
    min-height: 44px;
    padding: .6rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg);
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .btn--primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
  .btn--wide { width: 100%; }
  /* Відмова відокремлена навмисно: це дія, яку найдорожче натиснути
     випадково, і вона не має виглядати як сусідня «Виконано» */
  .btn--quiet { color: var(--muted); }
  .btn--danger { color: var(--danger); border-color: var(--danger); }

  /* ── Форми ────────────────────────────────────────────── */
  form { margin: 0 0 .75rem; }
  label { display: block; margin: .6rem 0 .2rem; color: var(--muted); font-size: .9rem; }
  input, select, textarea {
    width: 100%;
    min-height: 44px;
    padding: .55rem .7rem;
    font: inherit;
    color: var(--ink);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  textarea { min-height: 72px; resize: vertical; }
  .row { display: flex; gap: .5rem; flex-wrap: wrap; }
  .row > * { flex: 1 1 auto; }

  /* ── Блоки ────────────────────────────────────────────── */
  .panel {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: .85rem;
    margin-bottom: .75rem;
  }
  .warn {
    background: var(--warn-bg);
    color: var(--warn-ink);
    border-radius: var(--radius);
    padding: .6rem .75rem;
    margin: .5rem 0;
    font-weight: 600;
  }
  .empty { color: var(--muted); text-align: center; padding: 2rem .5rem; }

  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
`;

/* Тип тіла — саме той, що повертає тег `html` Hono: за наявності
   асинхронних вставок він віддає проміс, і вужчий тип змусив би
   приводити кожен виклик */
type Body = HtmlEscapedString | Promise<HtmlEscapedString>;

export function layout(title: string, body: Body, viewer?: Viewer, current?: string) {
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
          <nav>
            <a href="/" ${current === 'leads' ? raw('aria-current="page"') : ''}>Заявки</a>
            <a href="/today" ${current === 'today' ? raw('aria-current="page"') : ''}>Сьогодні</a>
          </nav>
          <form method="post" action="/logout">
            <button type="submit" class="btn btn--quiet" title="${viewer.name}">Вийти</button>
          </form>
        </header>`
      : ''}
    <main>${body}</main>
  </body>
</html>`;
}
