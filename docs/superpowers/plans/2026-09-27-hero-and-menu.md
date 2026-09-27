# Перший екран за макетом і бургер-меню — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перший екран на всю висоту вікна з фотографією-фоном, текстом поверх неї й двома кнопками в ряд; шапка з двома станами (прозора над фото, суцільна після нього); бургер-меню на телефоні й посилання просто в шапці на широкому екрані.

**Architecture:** Три шари в одній секції (`.hero__media` → `.hero__scrim` → `.hero__inner`), без нових залежностей і без JS для самої верстки. Перехід до наступної секції — нативний `scroll-snap` з двома точками привʼязки, не бібліотека. Шапка липка на всіх ширинах, підтягнута на свою висоту негативним `margin-bottom`, тому фото починається від верху вікна; стан «прозора/суцільна» перемикає `IntersectionObserver` за секцією `#hero` — той самий прийом, яким нижня панель стежить за `#hero-phone`. Меню — окремий компонент `NavMenu.astro` (кнопка + накладка + вся доступність), перелік пунктів збирається в `src/lib/nav.ts` з того, що реально відрисовано на сторінці.

**Tech Stack:** Astro 7.3.2 (статична збірка), Cloudflare Pages, zod-схеми контенту, `@lhci/cli` 0.15 для бюджету швидкості. Нових залежностей план не додає.

**Spec:** `docs/superpowers/specs/2026-09-27-hero-and-menu-design.md`

## Global Constraints

Це вимоги проєкту, вони діють у кожному завданні нижче.

- **Тестового фреймворку в проєкті немає.** Перевірка завдання — це команда з очікуваним виводом, а не автотест. Не додавати vitest/jest/playwright.
- **Нових залежностей не додавати.** `package.json` лишається без змін.
- **Бюджет Lighthouse** (`lighthouserc.json`, значення дослівно): `categories:performance` ≥ 0.95, `categories:accessibility` ≥ 0.95, `categories:seo` = 1, `largest-contentful-paint` ≤ 2000 мс, `cumulative-layout-shift` ≤ 0.02, `uses-responsive-images` — error. Локальний запуск: `npx lhci autorun --config=lighthouserc.json` по каталогу `dist`.
- **`npm run build` мусить і далі падати** на чотирьох заглушках (`phone_main`/`viber`, `telegram`, `address`, `OPERATOR` у політиці). Це запобіжник, а не збій. Прев'ю-збірка — `npm run build:preview`.
- **Жодного `#rrggbb` поза `src/layouts/Base.astro`.** Єдине виключення — фірмові кольори чужих брендів (`#7360F2` Viber, `#1088C6` Telegram) із коментарем, як уже зроблено в `SocialIcon.astro`, `Contacts.astro`, `StickyCall.astro`.
- **Коментарі в коді й будь-який видимий текст — українською.**
- **`id="hero-phone"` на кнопці телефона першого екрана не перейменовувати й не видаляти.** За ним стежить нижня липка панель (`src/components/StickyCall.astro:146`).
- **`id="hero"` на секції першого екрана** з Задачі 2 — за ним стежить шапка (Задача 3). Теж не перейменовувати.
- **Капс робить тільки CSS** (`text-transform: uppercase`). У `src/content/pages/home.yml` текст лишається звичайним регістром.
- **Доступність:** ціль дотику ≥ 44×44 px, контраст тексту ≥ 4.5:1, немає горизонтальної прокрутки від ширини 320px.
- **`prefers-reduced-motion: reduce`** вимикає привʼязку прокрутки цілком і анімацію меню.
- **Комітити після кожної задачі.** Повідомлення українською, у наказовому способі, і останнім рядком — `Co-Authored-By` тієї моделі, яка робить коміт (правило сесії).

## Що вже перевірено і зафіксовано

Три рішення, яких немає в специфікації, бо вони зʼявилися при вимірюванні. Реалізовувати саме так:

**Шапка стає липкою на всіх ширинах, не лише від 768px.** Зараз `position: sticky` увімкнена в `@media (min-width: 768px)`. Два стани шапки мають сенс тільки в липкої: інакше після першого екрана шапка просто виїжджає вгору й перемикати нічого. Бургер після прокрутки теж мусить лишатися досяжним. Ціна — 60px постійно зайнятого екрана на телефоні плюс нижня панель; це звичайна для таких сайтів плата.

**Посилання просто в шапці зʼявляються від 1000px, а не від 768px.** Специфікація каже 768. Виміряно: сім пунктів українською навіть скороченими підписами беруть близько 560px при `font-size: 0.92rem`, плюс логотип (~150px) і кнопка телефона (~190px) — це понад 900px, тоді як контейнер сайту 62rem = 992px. На 768px вони не вміщаються ніяк, а стиснута навігація гірша за бургер. Сенс вимоги («де є місце — показуємо посилання») зберігається, змінюється число. Перелік пунктів при цьому один і той самий, різняться лише підписи: повний у панелі, короткий у рядку шапки.

**Поверх фотографії немає приглушеного кольору тексту.** Ієрархія тримається на розмірі й вазі, колір усюди `--on-overlay` (білий). Причина: приглушений білий поверх невідомого знімка — це контраст, який не можна порахувати заздалегідь, а саме на цьому вже був регрес у проєкті.

## Файли

| Файл | Що з ним | Відповідальність після змін |
|---|---|---|
| `src/components/Hero.astro` | переписати розмітку й стилі | Три шари першого екрана: фото, затемнення, вміст |
| `src/content/pages/home.yml` | замінити `h1` і `hero_subtitle` | Тексти першого екрана |
| `src/layouts/Base.astro` | додати токени, привʼязку прокрутки, `.btn--on-photo`, проброс пропів | Палітра, глобальні правила, каркас сторінки |
| `src/components/Header.astro` | два стани, липкість на всіх ширинах, посилання в рядку | Шапка: логотип, навігація, кнопка дзвінка |
| `src/components/NavMenu.astro` | **створити** | Бургер, накладка меню і вся його доступність |
| `src/lib/nav.ts` | **створити** | Перелік пунктів меню з умовних секцій |
| `src/pages/index.astro` | передати `overHero`, `nav`, контакти | Збирання головної сторінки |
| `src/components/RepairVsReplace.astro` | `id="remont"` | без змін по суті |
| `src/components/Process.astro` | `id="process"` | без змін по суті |
| `src/components/Gallery.astro` | `id="roboty"` | без змін по суті |
| `src/components/Reviews.astro` | `id="vidhuky"` | без змін по суті |
| `src/components/Faq.astro` | `id="faq"` | без змін по суті |
| `README.md` | рядки про шапку й меню | Документація для наступного розробника |

Ідентифікатори секцій — остаточний перелік, інших не вигадувати:

| Секція | Ідентифікатор |
|---|---|
| Перший екран | `hero` (додається в Задачі 2) |
| Ремонт замість заміни | `remont` |
| Як це відбувається | `process` |
| Результати робіт | `roboty` |
| Відгуки | `vidhuky` |
| Питання і відповіді | `faq` |
| Форма заявки | `lead` (уже є) |
| Контакти | `contacts` (уже є) |

---

### Task 1: Ідентифікатори секцій

Дрібна механічна правка пʼяти файлів: по одному атрибуту в кожному. Якорям меню потрібно, на що посилатись.

**Files:**
- Modify: `src/components/RepairVsReplace.astro:32`
- Modify: `src/components/Process.astro:31`
- Modify: `src/components/Gallery.astro:28`
- Modify: `src/components/Reviews.astro:16`
- Modify: `src/components/Faq.astro:16`

**Interfaces:**
- Consumes: нічого
- Produces: якорі `#remont`, `#process`, `#roboty`, `#vidhuky`, `#faq` — на них посилається `src/lib/nav.ts` у Задачі 4

- [ ] **Step 1: Додати ідентифікатор у пʼять секцій**

Атрибут ставиться після класу, як це вже зроблено в `LeadForm.astro:19` і `Contacts.astro:28`.

`src/components/RepairVsReplace.astro:32`:
```astro
<section class="band band--alt rvr" id="remont">
```

`src/components/Process.astro:31`:
```astro
<section class="band band--dark process" id="process">
```

`src/components/Gallery.astro:28`:
```astro
<section class="band band--alt gal" id="roboty">
```

`src/components/Reviews.astro:16`:
```astro
<section class="band rev" id="vidhuky">
```

`src/components/Faq.astro:16`:
```astro
<section class="band band--alt faq" id="faq">
```

- [ ] **Step 2: Перевірити, що всі вісім якорів на місці й кожен один раз**

Run:
```bash
grep -rn 'id="\(hero\|remont\|process\|roboty\|vidhuky\|faq\|lead\|contacts\)"' src/components/
```
Expected: сім рядків — `remont`, `process`, `roboty`, `vidhuky`, `faq`, `lead`, `contacts`. `hero` тут ще немає, він зʼявиться в Задачі 2. Жоден ідентифікатор не повторюється.

- [ ] **Step 3: Збірка проходить**

Run: `npm run build:preview`
Expected: завершується успішно, `dist/index.html` перезаписано.

- [ ] **Step 4: Коміт**

```bash
git add src/components/RepairVsReplace.astro src/components/Process.astro src/components/Gallery.astro src/components/Reviews.astro src/components/Faq.astro
git commit -m "Ідентифікатори секцій під якорі меню"
```

---

### Task 2: Перший екран за макетом

Секція заввишки в екран, фотографія фоном, затемнення поверх неї, текст і кнопки поверх затемнення. Плюс нові тексти й привʼязка прокрутки.

На цьому кроці шапка ще стоїть над першим екраном у потоці — це нормальний промежуточний стан, сторінка робоча. Підтягне її Задача 3, і саме тому відступ під шапку закладається вже тут (`--hdr-h`).

**Files:**
- Modify: `src/components/Hero.astro` (переписати повністю)
- Modify: `src/content/pages/home.yml` (поля `h1`, `hero_subtitle`)
- Modify: `src/layouts/Base.astro` (токени в `:root`, `.btn--on-photo`, `scroll-padding-top`, привʼязка прокрутки)

**Interfaces:**
- Consumes: `formatPhone`, `telHref` з `src/lib/format.ts`; компонент `HeroVisual.astro`; проп `chips` з `index.astro` — тип `HeroChip` лишається без змін
- Produces:
  - `id="hero"` на секції — Задача 3 спостерігає за нею
  - `id="hero-phone"` на кнопці телефона — уже спостерігає `StickyCall.astro`
  - токен `--hdr-h` — Задача 3 підтягує шапку на цю ж висоту
  - клас `.btn--on-photo` у `Base.astro`
  - `interface Props { h1, subtitle?, phone, chips? }` — не змінюється, `index.astro` правити не треба

- [ ] **Step 1: Нові токени в `src/layouts/Base.astro`**

Додати в кінець блоку `:root` (після `--section-y`, перед закриттям `}` на рядку 190):

```css
        /* Висота шапки. Живе токеном, бо на неї спираються три місця:
           сама шапка, відступ першого екрана під нею і компенсація
           якорів (scroll-padding-top). */
        --hdr-h: 60px;

        /*
          Затемнення першого екрана. Не підгін під поточну картинку:
          знімок замінять, і світле фото не має ламати текст. Щільність
          розрахована на найгірший випадок — біле фото: навіть у
          найсвітлішій точці (0.68) білий текст дає ~6:1.
        */
        --hero-scrim: linear-gradient(
          180deg,
          rgba(15, 23, 42, 0.82) 0%,
          rgba(15, 23, 42, 0.68) 42%,
          rgba(15, 23, 42, 0.78) 100%
        );
        /* Підсвітка кнопки поверх фото під курсором */
        --on-photo-wash: rgba(255, 255, 255, 0.16);
```

Одразу після закриття `:root` (тобто після рядка 190) додати перевизначення висоти на широкому екрані:

```css
      /* Рядок шапки на десктопі вищий — див. .hdr__inner */
      @media (min-width: 768px) {
        :root { --hdr-h: 68px; }
      }
```

- [ ] **Step 2: Кнопка поверх фотографії — у `Base.astro`, поряд з іншими кнопками**

Додати після блоку `.btn--ghost:hover` (рядок 329):

```css
      /*
        Друга кнопка першого екрана. Прозора навмисно: біла заливка
        поруч із синьою давала дві однаково гучні кнопки, а головна
        дія тут одна — дзвінок. Світла рамка — єдине, що на затемненому
        фото робить її кнопкою.
      */
      .btn--on-photo {
        background: transparent;
        border-color: var(--on-overlay);
        color: var(--on-overlay);
      }
      .btn--on-photo:hover { background: var(--on-photo-wash); }
```

- [ ] **Step 3: Привʼязка прокрутки і компенсація якорів — у `Base.astro`**

Замінити блок рядків 218–222:

```css
      @media (min-width: 768px) {
        body { padding-bottom: 0; }
        /* Шапка на десктопі липка, тож якір не має ховатися під нею */
        html { scroll-padding-top: 5rem; }
      }
```

на:

```css
      /* Шапка липка на всіх ширинах, тож якір не має ховатися під нею */
      html { scroll-padding-top: calc(var(--hdr-h) + 0.5rem); }

      @media (min-width: 768px) {
        body { padding-bottom: 0; }
      }

      /*
        Привʼязка прокрутки — лише на межі першого екрана.

        Точок дві: сам перший екран і початок наступної секції. Решта
        сторінки не привʼязана взагалі: `proximity` притягує тільки
        поблизу точки, а елементів із scroll-snap-align більше немає,
        тож посеред довгого тексту ніщо не смикається.

        Для тих, хто попросив зменшити рух, привʼязки немає зовсім:
        різкий стрибок екрана при вестибулярних порушеннях — реальна
        проблема, а не незручність.
      */
      @media (prefers-reduced-motion: no-preference) {
        html { scroll-snap-type: y proximity; }
        .hero, .hero + * { scroll-snap-align: start; }
      }
```

- [ ] **Step 4: Нові тексти в `src/content/pages/home.yml`**

Замінити рядки `h1` і `hero_subtitle` (`seo_title`, `seo_description`, `guarantee` не торкатися):

```yaml
h1: "Ремонт тріщин та сколів лобового скла у Софіївській Борщагівці, Києві та області"
hero_subtitle: "Телефонуйте нашому оператору, щоб дізнатися вартість ремонту лобового скла вашого автомобіля, або залиште заявку — оператор зателефонує сам."
```

Регістр звичайний навмисно: капс робить CSS. `pageSchema` у `src/lib/site.ts:37` довжину `h1` не обмежує, обмеження 60 і 155 символів стосуються `seo_title` і `seo_description` — їх ця правка не торкається.

- [ ] **Step 5: Переписати `src/components/Hero.astro`**

Файл замінюється цілком. Кнопка телефона переноситься без жодної зміни атрибутів — той самий `id`, `data-cta`, `data-phone` і той самий svg. Розмітка чіпів (три варіанти іконки) теж переноситься як є, змінюються лише стилі.

```astro
---
import { formatPhone, telHref } from '../lib/format';
import HeroVisual from './HeroVisual.astro';

/**
 * Перший екран: знімок на всю висоту вікна, текст поверх нього.
 *
 * Три шари, знизу вгору:
 *   .hero__media — знімок (поки що графіка-заглушка HeroVisual)
 *   .hero__scrim — затемнення (--hero-scrim у Base.astro)
 *   .hero__inner — заголовок, підзаголовок, кнопки, чіпи
 *
 * Затемнення фіксоване, а не підігнане під поточну картинку: знімок
 * замінять, і світле фото не повинно зламати текст.
 *
 * Поверх фотографії немає приглушеного кольору тексту — усе біле,
 * ієрархія тримається на розмірі й вазі. Приглушений білий поверх
 * невідомого знімка дає контраст, який неможливо порахувати заздалегідь.
 *
 * Капс робить тільки CSS. У home.yml заголовок звичайним регістром:
 * інакше читалки екрана вимовляють його по літерах, а пошуковик
 * отримує крик.
 *
 * Два ідентифікатори тут не перейменовувати:
 *   id="hero"       — за секцією стежить шапка (Header.astro), щоб
 *                     перемкнути прозорий стан на суцільний
 *   id="hero-phone" — за кнопкою стежить нижня панель (StickyCall.astro)
 */
export type HeroChip = {
  icon: 'pin' | 'shield' | 'car';
  text: string;
};

interface Props {
  h1: string;
  subtitle?: string;
  phone: string;
  chips?: HeroChip[];
}

const { h1, subtitle, phone, chips = [] } = Astro.props;
---

<section class="hero" id="hero">
  <!--
    Шар знімка. Коли зʼявиться фотографія, вміст цього div замінюється
    цілком, решта верстки не змінюється:

      import heroPhoto from '../assets/hero.jpg';
      ...
      <Image src={heroPhoto} alt="" widths={[640, 960, 1440, 1920]}
             sizes="100vw" loading="eager" fetchpriority="high" />

    Фон першого екрана не можна вантажити ліниво — він і буде найбільшим
    елементом, за яким Lighthouse міряє LCP. alt порожній навмисно:
    фон нічого не повідомляє, усе сказано заголовком поруч.
  -->
  <div class="hero__media" aria-hidden="true">
    <HeroVisual />
  </div>

  <div class="hero__scrim" aria-hidden="true"></div>

  <div class="hero__inner">
    <h1 class="hero__title">{h1}</h1>

    {subtitle && <p class="hero__sub">{subtitle}</p>}

    <div class="hero__cta">
      <a id="hero-phone" class="btn btn--primary btn--lg" href={telHref(phone)} data-cta="hero" data-phone>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"></path>
        </svg>
        <span>{formatPhone(phone)}</span>
      </a>

      <a class="btn btn--on-photo" href="#lead" data-cta="hero_form">
        Надіслати фото сколу
      </a>
    </div>

    {chips.length > 0 && (
      <ul class="hero__trust">
        {chips.map((c) => (
          <li>
            {c.icon === 'pin' && (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
                <circle cx="12" cy="10" r="2.6" fill="currentColor"></circle>
              </svg>
            )}
            {c.icon === 'shield' && (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 3l7 3v6c0 4.2-3 7.7-7 9-4-1.3-7-4.8-7-9V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.8"></path>
                <path d="M8.7 12.2l2.2 2.2 4.3-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
              </svg>
            )}
            {c.icon === 'car' && (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3.4 16.2v-3l1.7-4.1a2 2 0 011.9-1.3h10a2 2 0 011.9 1.3l1.7 4.1v3a.9.9 0 01-.9.9H4.3a.9.9 0 01-.9-.9z" fill="none" stroke="currentColor" stroke-width="1.7"></path>
                <path d="M3.6 13.2h16.8" fill="none" stroke="currentColor" stroke-width="1.7"></path>
                <circle cx="7.4" cy="15.1" r="1.1" fill="currentColor"></circle>
                <circle cx="16.6" cy="15.1" r="1.1" fill="currentColor"></circle>
              </svg>
            )}
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
</section>

<style>
  /*
    svh, а не vh. Різниця саме на телефоні: vh рахується без адресного
    рядка браузера, і коли той ховається під час прокрутки, екран
    смикається. svh бере найменший варіант і стоїть на місці.
  */
  .hero {
    position: relative;
    min-height: 100svh;
    /*
      Місце під шапку, яка лежить поверх фотографії. Відступ саме тут,
      а не всередині .hero__inner: тоді вміст центрується в тому, що
      лишилось під шапкою, і не з'їжджає донизу від несиметричних полів.
      Висоту секції це не збільшує — box-sizing: border-box глобальний.
      Шари фото й затемнення відступ не зачіпає: вони позиціюються від
      padding-box, тобто все одно накривають секцію цілком.
    */
    padding-top: var(--hdr-h);
    display: grid;
    align-content: center;
    overflow: hidden;
  }

  .hero__media,
  .hero__scrim {
    position: absolute;
    inset: 0;
  }
  .hero__media { z-index: 0; }
  .hero__scrim { z-index: 1; background: var(--hero-scrim); }

  /*
    Заглушка намальована як картка з полями й радіусом. Тут вона
    працює фоном, тож рамку, скруглення й обмеження висоти знімаємо.
    Коли замість неї стане <Image>, це правило піде разом із нею.
  */
  .hero__media :global(.hv) {
    width: 100%;
    height: 100%;
    max-height: none;
    aspect-ratio: auto;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .hero__inner {
    position: relative;
    z-index: 2;
    display: grid;
    gap: 1rem;
    justify-items: start;
    /* Симетрично: місце під шапку дає сама секція, тут поля лише
       щоб вміст не впирався в краї, коли не вміщається в екран */
    padding-block: clamp(1.5rem, 5vh, 2.5rem);
    /* Той самий контейнер, що й у .band — щоб текст стояв по одній
       вертикалі з рештою сторінки */
    padding-inline: max(1rem, calc((100% - var(--container)) / 2));
    color: var(--on-overlay);
  }

  .hero__title {
    margin: 0;
    /* Капс українською — це чотири-пʼять рядків на телефоні, тому
       кегль нижчий за звичайний заголовок, а міжлітерний просвіт не
       відʼємний: у капсі мінус злипає літери */
    text-transform: uppercase;
    font-size: clamp(1.4rem, 5.2vw, 2.6rem);
    line-height: 1.14;
    letter-spacing: 0;
    text-wrap: balance;
    max-width: 26ch;
  }

  .hero__sub {
    margin: 0;
    font-size: clamp(0.98rem, 3.1vw, 1.12rem);
    line-height: 1.5;
    max-width: 46ch;
  }

  .hero__cta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    margin-top: 0.15rem;
  }
  .hero__cta .btn svg { width: 20px; height: 20px; flex: none; }

  .hero__trust {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem 1.15rem;
  }
  .hero__trust li {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.88rem;
  }
  /* Іконка теж біла: акцентний синій по затемненому фото не читається */
  .hero__trust svg { width: 17px; height: 17px; flex: none; color: var(--on-overlay); }

  @media (min-width: 768px) {
    .hero__inner { gap: 1.15rem; max-width: none; }
    .hero__title { max-width: 24ch; }
  }

  @media (min-width: 900px) {
    .hero__inner { padding-block: clamp(2rem, 7vh, 3.5rem); }
  }
</style>
```

- [ ] **Step 6: Збірка проходить, у розмітці все на місці**

Run: `npm run build:preview`
Expected: успішно.

Run:
```bash
node -e "
const h = require('fs').readFileSync('dist/index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
for (const id of ['hero', 'hero-phone']) {
  console.log(id, (h.match(new RegExp('id=\"' + id + '\"', 'g')) || []).length);
}
"
```
Expected: `hero 1` і `hero-phone 1`.

Два уточнення, чому саме так, а не `grep`. HTML-коментарі доїжджають у зібрану сторінку, і коментар у `StickyCall.astro` містить рядок `id="hero-phone"` як документацію залежності — простий `grep` дає два збіги на один реальний елемент. Тому коментарі вирізаються. І рахувати треба збіги, а не рядки: `grep -c` порахував би рядки, а зібраний HTML стоїть у 84 рядках.

Run:
```bash
grep -o 'text-transform:\s*uppercase' dist/_astro/*.css | head -1
```
Expected: збіг знайдено. CSS у зібраному вигляді лежить не в `index.html`, а окремими файлами в `dist/_astro/` з хешем у назві — тому шлях із зірочкою.

Run:
```bash
grep -o 'СОФІЇВСЬКІЙ' dist/index.html | head -1
```
Expected: **порожній вивід**. Заголовок у розмітці звичайним регістром — якщо капс потрапив у HTML, значить його зробили не CSS-ом.

Run:
```bash
grep -o 'Софіївській Борщагівці, Києві та області' dist/index.html | head -1
```
Expected: рядок знайдено.

- [ ] **Step 7: Порахувати контраст білого тексту в найгіршому випадку**

Затемнення має тримати читаність незалежно від знімка. Найгірший знімок — суцільно білий: тоді під текстом лишається тільки колір затемнення, змішаний з білим.

Run:
```bash
node --input-type=module -e "
const srgb = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
// Затемнення rgba(15,23,42,a) поверх білого фото
const over = (a) => [15, 23, 42].map((c) => a * c + (1 - a) * 255);
// Білий текст поверх результату
const ratio = (a) => (1.05 / (lum(over(a)) + 0.05)).toFixed(2);
for (const a of [0.82, 0.68, 0.78]) console.log(a, ratio(a));
"
```
Expected: три рядки — `0.82 10.25`, `0.68 6.18`, `0.78 8.87`. Кожне значення **≥ 4.5**. Якщо якесь нижче — підняти відповідну щільність у `--hero-scrim` і повторити.

- [ ] **Step 8: Коміт**

```bash
git add src/components/Hero.astro src/content/pages/home.yml src/layouts/Base.astro
git commit -m "Перший екран за макетом: фото на всю висоту, капс, кнопки в ряд"
```

---

### Task 3: Шапка з двома станами

Шапка стає липкою на всіх ширинах і на головній лежить поверх фотографії прозорою, а після першого екрана — суцільною. Меню в цій задачі ще немає, воно в Задачі 4.

**Files:**
- Modify: `src/components/Header.astro`
- Modify: `src/layouts/Base.astro` (проп `overHero` і проброс у `<Header>`)
- Modify: `src/pages/index.astro` (передати `overHero`)
- Modify: `README.md:125`

**Interfaces:**
- Consumes: токен `--hdr-h` і `id="hero"` із Задачі 2
- Produces:
  - `Header.astro`: `interface Props { phone?: string; overHero?: boolean }`
  - `Base.astro`: `interface Props { title, description, noindex?, phone?, overHero? }`
  - клас `.hdr--over` і атрибут `data-solid` (`'true'` | `'false'`) на `<header class="hdr">`
  - колір вмісту шапки успадковується від `.hdr__inner` — Задача 4 покладається на це для бургера

- [ ] **Step 1: `Header.astro` — проп і розмітка**

Замінити фронтматер (рядки 1–19) на:

```astro
---
import { formatPhone, telHref } from '../lib/format';

/**
 * Шапка сайту. Липка на всіх ширинах.
 *
 * Два стани, і потрібні вони через фотографію першого екрана.
 * Прозора липка шапка, виїжджаючи з темного знімка на білий контент,
 * робить світлий текст невидимим. Тому стан перемикається, коли
 * перший екран іде вгору: прозора → суцільна.
 *
 *   overHero=true  → тільки головна: прозора поверх фото, підтягнута
 *                    на свою висоту, щоб знімок починався від верху
 *                    вікна. data-solid перемикає скрипт унизу файлу.
 *   overHero=false → /thanks/, /404, політика: суцільна завжди, там
 *                    фотографії немає.
 *
 * Спостерігач той самий прийом, що й у нижньої панелі
 * (StickyCall.astro): вона стежить за кнопкою телефона, ця шапка —
 * за самою секцією #hero. Обидві реакції на вихід першого екрана
 * перевіряти разом: полагодивши одну, легко зламати другу.
 *
 * Телефон у шапці зʼявляється від 768px — рівно там, де ховається
 * нижня липка панель. Так кнопка дзвінка є завжди, але жодного разу
 * не дублюється.
 */
interface Props {
  phone?: string;
  overHero?: boolean;
}
const { phone, overHero = false } = Astro.props;
---
```

Замінити відкриваючий тег `<header class="hdr">` (рядок 21) на:

```astro
<header class:list={['hdr', overHero && 'hdr--over']} data-solid={overHero ? 'false' : 'true'}>
```

Тег `<a class="hdr__brand">`, позначку, назву й кнопку телефона (рядки 22–48) лишити без змін.

- [ ] **Step 2: `Header.astro` — стилі**

Замінити весь блок `<style>` (рядки 51–106) на:

```astro
<style>
  .hdr {
    position: sticky;
    top: 0;
    /*
      Вище за нижню панель (z-index 50). Меню (Задача 4) — накладка
      всередині шапки, і накрити нижню панель вона може тільки якщо
      шапка стоїть вище за неї. Верх і низ екрана не перетинаються,
      тож порядок між ними ні на що більше не впливає.
    */
    z-index: 60;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding-inline: max(1rem, calc((100% - var(--container)) / 2));
    transition: background-color 0.2s ease-out, border-color 0.2s ease-out,
                color 0.2s ease-out;
  }

  .hdr__inner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: var(--hdr-h);
  }

  /*
    Прозорий стан на головній.

    Підтягування на власну висоту — щоб фотографія починалася від
    верху вікна, а не під шапкою. Відступ не зникає, а перетікає в
    .hero__inner (padding-block-start), тож перемикання станів нічого
    не зсуває: змінюються лише кольори, розкладка стоїть на місці.
  */
  .hdr--over {
    margin-bottom: calc(-1 * var(--hdr-h));
    background: transparent;
    border-bottom-color: transparent;
  }
  /* Колір успадковують і назва, і посилання, і кнопка бургера */
  .hdr--over .hdr__inner { color: var(--on-overlay); }

  .hdr--over[data-solid='true'] {
    background: var(--surface);
    border-bottom-color: var(--border);
  }
  .hdr--over[data-solid='true'] .hdr__inner { color: var(--text); }

  .hdr__brand {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    color: inherit;
    text-decoration: none;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin-right: auto;
  }

  .hdr__mark { width: 30px; height: 30px; border-radius: 8px; flex: none; }

  .hdr__name { font-size: 1rem; white-space: nowrap; }

  /* На вузьких екранах лишається сама позначка: назва зʼїдала б
     місце, потрібне кнопці дзвінка й бургеру */
  @media (max-width: 400px) {
    .hdr__name { display: none; }
  }

  /* Телефон у шапці — рівно там, де зникає нижня панель */
  .hdr__call { display: none; }
  .hdr__call svg { width: 18px; height: 18px; flex: none; }

  @media (min-width: 768px) {
    .hdr { padding-inline: max(1.5rem, calc((100% - var(--container)) / 2)); }
    .hdr__inner { gap: 1rem; }
    .hdr__name { font-size: 1.05rem; }
    .hdr__call {
      display: inline-flex;
      min-height: 44px;
      padding: 0 1rem;
      font-size: 0.98rem;
    }
  }
</style>
```

- [ ] **Step 3: `Header.astro` — перемикач стану**

Додати в кінець файлу, після `</style>`:

```astro
<script>
  const hdr = document.querySelector('.hdr');
  const hero = document.getElementById('hero');

  // Прозорий стан є тільки там, де під шапкою фотографія
  if (hdr instanceof HTMLElement && hdr.classList.contains('hdr--over')) {
    if (hero && 'IntersectionObserver' in window) {
      // Верхню межу видимої області підрізаємо на висоту шапки:
      // тоді перший екран «закінчується» саме під нею, а не під
      // верхом вікна.
      const shrink = Math.round(hdr.getBoundingClientRect().height);

      new IntersectionObserver(
        ([entry]) => {
          hdr.dataset.solid = entry.isIntersecting ? 'false' : 'true';
        },
        { rootMargin: `-${shrink}px 0px 0px 0px` }
      ).observe(hero);
    } else {
      // Старий браузер: лишаємо суцільну. Прозорість — оздоблення,
      // а світлий текст на білому не читається взагалі.
      hdr.dataset.solid = 'true';
    }
  }
</script>
```

- [ ] **Step 4: `Base.astro` — проброс пропа**

Рядки 4–10 замінити на:

```astro
interface Props {
  title: string;
  description: string;
  noindex?: boolean;
  phone?: string;
  /* Прозора шапка поверх фотографії — тільки на головній */
  overHero?: boolean;
}
const { title, description, noindex = false, phone, overHero = false } = Astro.props;
```

Рядок 75 замінити на:

```astro
    <Header phone={phone} overHero={overHero} />
```

- [ ] **Step 5: `index.astro` — увімкнути прозору шапку**

Рядок 20 замінити на:

```astro
<Base title={meta.seo_title} description={meta.seo_description} phone={phone} overHero>
```

- [ ] **Step 6: `README.md` — рядок про шапку більше не правдивий**

Рядок 125 зараз каже, що навігації в шапці немає. Замінити:

```markdown
| Шапка (логотип, навігація, кнопка дзвінка) | `src/components/Header.astro` |
```

- [ ] **Step 7: Перевірити стани в розмітці**

Run: `npm run build:preview`
Expected: успішно.

Run:
```bash
grep -o 'class="[^"]*hdr--over[^"]*"' dist/index.html | head -1 && grep -o 'data-solid="false"' dist/index.html | head -1
```
Expected: клас із `hdr--over` знайдено, `data-solid="false"` знайдено — головна віддається з прозорою шапкою.

Run:
```bash
node -e "
const fs = require('fs');
for (const f of ['dist/404.html', 'dist/thanks/index.html', 'dist/polityka-konfidentsiynosti/index.html']) {
  const h = fs.readFileSync(f, 'utf8');
  const cls = (h.match(/<header[^>]*class=\"([^\"]*)\"/) || [])[1];
  const solid = (h.match(/<header[^>]*data-solid=\"([^\"]*)\"/) || [])[1];
  console.log(f, JSON.stringify(cls), JSON.stringify(solid));
}
"
```
Expected: для кожного файлу `"hdr"` і `"true"` — клас без `hdr--over`, стан суцільний.

Перевіряти саме тег `<header>`, а не шукати `hdr--over` по всьому файлу: скрипт шапки інлайниться в кожну сторінку, і рядок `classList.contains('hdr--over')` у його тексті дає збіг там, де прозорої шапки насправді немає.

- [ ] **Step 8: Перевірити, що документація не розійшлася з кодом**

Run: `npm run validate`
Expected: завершується кодом 0; у звіті лише чотири відомі заглушки (телефон/Viber, Telegram, адреса, ФОП у політиці) і жодної скарги на шляхи з README.

- [ ] **Step 9: Коміт**

```bash
git add src/components/Header.astro src/layouts/Base.astro src/pages/index.astro README.md
git commit -m "Шапка з двома станами: прозора над фото, суцільна після"
```

---

### Task 4: Бургер-меню і посилання в шапці

Меню — окремий компонент: кнопка, накладка і вся доступність в одному файлі. Перелік пунктів збирається з того, що реально відрисовано.

**Files:**
- Create: `src/lib/nav.ts`
- Create: `src/components/NavMenu.astro`
- Modify: `src/components/Header.astro` (посилання в рядку, підключення `NavMenu`)
- Modify: `src/layouts/Base.astro` (пропи `nav`, `viber`, `telegram`, `address` і проброс)
- Modify: `src/pages/index.astro` (зібрати перелік і передати контакти)
- Modify: `README.md` (два нові рядки в таблиці)

**Interfaces:**
- Consumes: якорі з Задачі 1; клас `.hdr__inner` і успадкування кольору з Задачі 3
- Produces:
  - `src/lib/nav.ts`: `export type NavItem = { href: string; label: string; short: string }` і `export function buildNav(show: { gallery: boolean; reviews: boolean }): NavItem[]`
  - `NavMenu.astro`: `interface Props { items: NavItem[]; phone?: string; viber?: string; telegram?: string; address?: string }`
  - `Header.astro`: `interface Props { phone?, overHero?, nav?: NavItem[], viber?, telegram?, address? }`
  - `Base.astro`: ті самі чотири нові пропи, що прокидаються в `Header`

- [ ] **Step 1: `src/lib/nav.ts` — перелік пунктів**

```ts
/**
 * Пункти меню.
 *
 * Збираються з того, що реально відрисовано на сторінці: галерея й
 * відгуки зʼявляються лише коли матеріалу достатньо (пороги в
 * src/lib/site.ts). Посилання на секцію, якої на сторінці немає, —
 * гірше за відсутній пункт: людина натискає і нічого не відбувається.
 *
 * Два підписи навмисно. Повний (`label`) — у панелі меню, там місця
 * вдосталь. Короткий (`short`) — у рядку шапки на широкому екрані:
 * сім повних назв українською в один рядок не вміщаються.
 *
 * Порядок — порядок появи секцій на сторінці, і це не випадково:
 * меню мусить читатися як зміст, а не як набір.
 */
export type NavItem = {
  /** Якір секції, напр. '#faq' */
  href: string;
  /** Повна назва — панель меню */
  label: string;
  /** Коротка назва — рядок шапки */
  short: string;
};

export function buildNav(show: { gallery: boolean; reviews: boolean }): NavItem[] {
  return [
    { href: '#remont', label: 'Ремонт замість заміни', short: 'Ремонт' },
    { href: '#process', label: 'Як це відбувається', short: 'Як це буде' },
    ...(show.gallery
      ? [{ href: '#roboty', label: 'Результати робіт', short: 'Роботи' }]
      : []),
    ...(show.reviews ? [{ href: '#vidhuky', label: 'Відгуки', short: 'Відгуки' }] : []),
    { href: '#faq', label: 'Питання і відповіді', short: 'Питання' },
    { href: '#lead', label: 'Залишити заявку', short: 'Заявка' },
    { href: '#contacts', label: 'Контакти', short: 'Контакти' },
  ];
}
```

- [ ] **Step 2: `src/components/NavMenu.astro` — розмітка**

```astro
---
import { formatPhone, telHref, viberHref, telegramHref } from '../lib/format';
import SocialIcon from './SocialIcon.astro';
import type { NavItem } from '../lib/nav';

/**
 * Бургер і панель меню.
 *
 * Чому окремий файл, а не всередині Header.astro: тут кнопка,
 * накладка, стилі й уся доступність меню — разом це більше, ніж
 * решта шапки. Шапка лишається шапкою.
 *
 * Панель — position: fixed усередині шапки. Працює це тому, що
 * position: sticky не створює контейнера для fixed-нащадків, і панель
 * позиціюється від вікна. А накрити нижню липку панель вона може
 * тільки завдяки z-index: 60 у .hdr — див. коментар там.
 *
 * Доступність — основна робота в цьому файлі, і кожен рядок нижче
 * прибирає конкретну поломку, а не перестраховується:
 *   aria-expanded          читалка каже «згорнуто/розгорнуто»
 *   фокус у панель         інакше клавіатура лишається невідомо де
 *   Escape                 очікувана поведінка будь-якої накладки
 *   фокус назад на кнопку  інакше людина опиняється на початку сторінки
 *   пастка фокуса          інакше Tab іде по посиланнях під накладкою
 *   блок прокрутки         інакше тло їде при свайпі
 *
 * Закрита панель — visibility: hidden. Цього достатньо, щоб її не
 * бачила ні читалка екрана, ні Tab: hidden і inert не потрібні.
 */
interface Props {
  items: NavItem[];
  phone?: string;
  viber?: string;
  telegram?: string;
  address?: string;
}

const { items, phone, viber, telegram, address } = Astro.props;
---

<button
  class="burger"
  type="button"
  id="nav-toggle"
  aria-expanded="false"
  aria-controls="nav-panel"
  aria-label="Меню"
>
  <svg class="burger__bars" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
  </svg>
  <svg class="burger__cross" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
  </svg>
</button>

<div class="nav" id="nav-panel" data-open="false">
  <div class="nav__scrim" data-nav-close aria-hidden="true"></div>

  <nav class="nav__panel" aria-label="Меню сайту">
    <ul class="nav__list">
      {items.map((i) => (
        <li><a href={i.href} data-nav-link>{i.label}</a></li>
      ))}
    </ul>

    <div class="nav__contact">
      {phone && (
        <a class="nav__phone" href={telHref(phone)} data-cta="menu" data-phone>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.2.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"></path>
          </svg>
          <span>{formatPhone(phone)}</span>
        </a>
      )}

      {(viber || telegram) && (
        <div class="nav__social">
          {viber && (
            <a class="nav__soc nav__soc--viber" href={viberHref(viber)} data-cta="menu" aria-label="Написати у Viber">
              <SocialIcon kind="viber" />
            </a>
          )}
          {telegram && (
            <a class="nav__soc nav__soc--telegram" href={telegramHref(telegram)} data-cta="menu" aria-label="Написати в Telegram">
              <SocialIcon kind="telegram" />
            </a>
          )}
        </div>
      )}

      {address && <p class="nav__addr">{address}</p>}

      <a class="nav__legal" href="/polityka-konfidentsiynosti/">Політика конфіденційності</a>
    </div>
  </nav>
</div>
```

- [ ] **Step 3: `NavMenu.astro` — стилі**

Додати після розмітки:

```astro
<style>
  .burger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 44px — мінімальна ціль дотику */
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    /* Колір приходить від .hdr__inner: над фото світлий, після — темний */
    color: inherit;
    cursor: pointer;
  }
  .burger svg { width: 26px; height: 26px; }

  .burger__cross { display: none; }
  .burger[aria-expanded='true'] .burger__bars { display: none; }
  .burger[aria-expanded='true'] .burger__cross { display: block; }

  /* Від 1000px посилання стоять просто в шапці — кнопка не потрібна.
     Число не 768: сім пунктів українською в рядок туди не вміщаються,
     див. Header.astro */
  @media (min-width: 1000px) {
    .burger { display: none; }
  }

  .nav {
    position: fixed;
    inset: 0;
    display: grid;
    justify-items: end;
    visibility: hidden;
    opacity: 0;
    /* Затримка саме на visibility: інакше панель зникає, не догорівши.
       pointer-events знімаємо одразу — щоб закрита, але ще видима
       накладка не перехоплювала дотик */
    pointer-events: none;
    transition: opacity 0.2s ease-out, visibility 0s linear 0.2s;
  }
  .nav[data-open='true'] {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
    transition: opacity 0.2s ease-out;
  }

  .nav__scrim {
    position: absolute;
    inset: 0;
    background: var(--overlay);
  }

  .nav__panel {
    position: relative;
    width: min(21rem, 100%);
    height: 100%;
    overflow-y: auto;
    /* Дотягнувши панель до краю, не гортаємо сторінку під нею */
    overscroll-behavior: contain;
    padding: calc(var(--hdr-h) + 1rem) 1.25rem
             calc(1.5rem + env(safe-area-inset-bottom, 0px));
    background: var(--surface);
    /* Колір задається явно: панель лежить усередині шапки, а та над
       фото робить вміст білим — білий текст на білій панелі */
    color: var(--text);
    box-shadow: var(--shadow);
    display: grid;
    gap: 1.5rem;
    align-content: start;
    transform: translateX(5%);
    transition: transform 0.2s ease-out;
  }
  .nav[data-open='true'] .nav__panel { transform: translateX(0); }

  /*
    Окремого правила під «зменшити рух» тут немає навмисно: глобальне
    в Base.astro уже зводить transition-duration до 0.01ms для всього
    на сторінці. Друга копія того самого правила розійдеться з першою.
  */

  .nav__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .nav__list a {
    display: flex;
    align-items: center;
    min-height: 48px;
    color: var(--text);
    text-decoration: none;
    font-size: 1.05rem;
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }
  .nav__list li:last-child a { border-bottom: 0; }

  .nav__contact { display: grid; gap: 0.9rem; justify-items: start; }

  .nav__phone {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 48px;
    color: var(--accent);
    text-decoration: none;
    font-size: 1.25rem;
    font-weight: 700;
  }
  .nav__phone svg { width: 20px; height: 20px; flex: none; }

  .nav__social { display: flex; gap: 0.5rem; }

  .nav__soc {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    min-width: 48px;
    border: 1px solid var(--border);
    border-radius: var(--r);
    text-decoration: none;
  }

  /*
    Ті самі фірмові кольори, що в Contacts.astro і StickyCall.astro:
    колір розтягнутий по рамці кнопки, а не лишений дрібним кубиком
    іконки. Telegram темніший за офіційний #2AABEE навмисно —
    див. коментар у SocialIcon.astro.
  */
  .nav__soc--viber { border-color: #7360F2; }
  .nav__soc--telegram { border-color: #1088C6; }

  .nav__addr { margin: 0; font-size: 0.94rem; color: var(--muted); }

  .nav__legal {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: 0.875rem;
    color: var(--muted);
  }
</style>
```

- [ ] **Step 4: `NavMenu.astro` — скрипт**

Додати в кінець файлу:

```astro
<script>
  const toggle = document.getElementById('nav-toggle');
  const panel = document.getElementById('nav-panel');

  if (toggle && panel) {
    const FOCUSABLE = 'a[href], button:not([disabled])';
    const wide = window.matchMedia('(min-width: 1000px)');
    let lastFocused: HTMLElement | null = null;

    const isOpen = () => panel.dataset.open === 'true';

    const open = () => {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      panel.dataset.open = 'true';
      toggle.setAttribute('aria-expanded', 'true');
      document.documentElement.classList.add('nav-open');

      // Фокус у панель: інакше людина з клавіатурою лишається
      // невідомо де, і наступний Tab іде по сторінці під накладкою
      const first = panel.querySelector(FOCUSABLE);
      if (first instanceof HTMLElement) first.focus();
    };

    const close = (returnFocus = true) => {
      panel.dataset.open = 'false';
      toggle.setAttribute('aria-expanded', 'false');
      document.documentElement.classList.remove('nav-open');
      if (returnFocus) (lastFocused ?? toggle).focus();
    };

    toggle.addEventListener('click', () => (isOpen() ? close() : open()));

    panel.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest('[data-nav-close]')) {
        close();
        return;
      }

      // Пункт меню — якір на цій самій сторінці. Без закриття людина
      // лишилась би дивитись на меню замість секції. Фокус назад на
      // кнопку тут не повертаємо: він має піти за посиланням.
      if (target.closest('[data-nav-link]')) close(false);
    });

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }

      if (e.key !== 'Tab') return;

      // Пастка фокуса. Очима вона не видна — тільки з клавіатури
      const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Від 1000px кнопка бургера зникає. Якби панель лишилась
    // відкритою після повороту телефона чи зміни розміру вікна,
    // закрити її було б нічим
    wide.addEventListener('change', (e) => {
      if (e.matches && isOpen()) close(false);
    });
  }
</script>
```

- [ ] **Step 5: Блок прокрутки — у `Base.astro`**

Клас навішується на `<html>`, тож правило має бути глобальним. Точне місце: у `Base.astro` між блоком `@media (min-width: 768px) { body { padding-bottom: 0; } }` і коментарем про привʼязку прокрутки (обидва додала Задача 2) — так правило стоїть поряд із рештою правил для `html`, а коментар не відривається від свого блоку.

```css
      /*
        Поки відкрите меню, сторінка під ним не гортається.
        Клас навішує NavMenu.astro. overflow на <html>, а не
        position: fixed на <body>: друге надійніше в iOS, але втрачає
        місце прокрутки — панель і так накриває екран цілком, тож
        протікання тла тут косметика, а не поломка.
      */
      html.nav-open { overflow: hidden; }
```

- [ ] **Step 6: `Header.astro` — посилання в рядку і підключення меню**

У фронтматері додати імпорти й пропи. Рядок `import { formatPhone, telHref } from '../lib/format';` лишається; після нього:

```astro
import NavMenu from './NavMenu.astro';
import type { NavItem } from '../lib/nav';
```

`interface Props` замінити на:

```astro
interface Props {
  phone?: string;
  overHero?: boolean;
  nav?: NavItem[];
  viber?: string;
  telegram?: string;
  address?: string;
}
const { phone, overHero = false, nav = [], viber, telegram, address } = Astro.props;
```

У розмітці, між `</a>` бренда й кнопкою телефона, додати посилання:

```astro
    {nav.length > 0 && (
      <ul class="hdr__links">
        {nav.map((i) => (
          <li><a href={i.href}>{i.short}</a></li>
        ))}
      </ul>
    )}
```

Після кнопки телефона (після закриття блоку `{phone && (…)}`) додати меню:

```astro
    {nav.length > 0 && (
      <NavMenu items={nav} phone={phone} viber={viber} telegram={telegram} address={address} />
    )}
```

У `<style>` додати перед блоком `@media (min-width: 768px)`:

```css
  /*
    Посилання просто в шапці — від 1000px, не від 768px.

    Виміряно: сім пунктів скороченими підписами беруть близько 560px,
    плюс логотип і кнопка телефона — це понад 900px при контейнері
    992px. На 768px вони не вміщаються, а стиснута навігація гірша за
    бургер. До 1000px працює кнопка меню (NavMenu.astro).
  */
  .hdr__links { display: none; }

  @media (min-width: 1000px) {
    .hdr__links {
      display: flex;
      align-items: center;
      gap: 0.9rem;
      margin: 0 0.9rem 0 0;
      padding: 0;
      list-style: none;
    }
    .hdr__links a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      color: inherit;
      text-decoration: none;
      font-size: 0.92rem;
      white-space: nowrap;
    }
    .hdr__links a:hover { text-decoration: underline; }
  }
```

- [ ] **Step 7: `Base.astro` — проброс чотирьох пропів**

`interface Props` доповнити (після `overHero`):

```astro
  /* Пункти меню. Порожній масив — меню немає взагалі: так на
     /thanks/, /404 і політиці, де навігувати нема по чому */
  nav?: NavItem[];
  viber?: string;
  telegram?: string;
  address?: string;
```

Додати імпорт типу під `import Header from '../components/Header.astro';`:

```astro
import type { NavItem } from '../lib/nav';
```

Деструктуризацію замінити на:

```astro
const {
  title,
  description,
  noindex = false,
  phone,
  overHero = false,
  nav = [],
  viber,
  telegram,
  address,
} = Astro.props;
```

Виклик шапки:

```astro
    <Header
      phone={phone}
      overHero={overHero}
      nav={nav}
      viber={viber}
      telegram={telegram}
      address={address}
    />
```

- [ ] **Step 8: `index.astro` — зібрати перелік і передати контакти**

Додати імпорт після `import { loadSite } from '../lib/site';`:

```astro
import { buildNav } from '../lib/nav';
```

Після `const { contacts, meta, phone, show } = site;` додати:

```astro
// Пункти меню — з того, що реально відрисовано нижче
const nav = buildNav(show);
```

Виклик `<Base>` замінити на:

```astro
<Base
  title={meta.seo_title}
  description={meta.seo_description}
  phone={phone}
  overHero
  nav={nav}
  viber={contacts.viber}
  telegram={contacts.telegram}
  address={contacts.address}
>
```

- [ ] **Step 9: `README.md` — два нові рядки**

У таблиці «де що правити», одразу після рядка про шапку (`src/components/Header.astro`), додати:

```markdown
| Меню на телефоні (панель, контакти в ній, політика) | `src/components/NavMenu.astro` |
| Перелік пунктів меню і їхні підписи | `src/lib/nav.ts` |
```

- [ ] **Step 10: Перевірити розмітку меню**

Run: `npm run build:preview`
Expected: успішно.

Run:
```bash
grep -o 'aria-controls="nav-panel"' dist/index.html | head -1 && grep -o 'aria-expanded="false"' dist/index.html | head -1 && grep -o 'data-nav-link' dist/index.html | wc -l
```
Expected: `aria-controls="nav-panel"`, `aria-expanded="false"`, і `5` — саме пʼять пунктів. Галерея й відгуки зараз під порогом показу (`src/lib/site.ts`), тож пунктів «Роботи» й «Відгуки» бути не має. Кількість — через `grep -o | wc -l`, бо `grep -c` порахував би рядки, а не збіги.

Run:
```bash
grep -o '#roboty\|#vidhuky' dist/index.html | head -1
```
Expected: **порожній вивід**. Меню не посилається на секції, яких на сторінці немає.

Run:
```bash
for f in dist/thanks/index.html dist/404.html dist/polityka-konfidentsiynosti/index.html; do
  echo "$f: $(grep -o 'nav-panel' "$f" | wc -l)"
done
```
Expected: `0` для кожного. Там меню немає.

- [ ] **Step 11: Перевірити, що посилання в рядку шапки вміщаються**

Тимчасово увімкнути обидва умовні пункти, щоб міряти найгірший випадок — сім пунктів. У `src/pages/index.astro` замінити `const nav = buildNav(show);` на `const nav = buildNav({ gallery: true, reviews: true });`, зібрати (`npm run build:preview`), відкрити `http://127.0.0.1:8788` (у сесії вже підняті wrangler на 8788 і тунель; якщо сервера немає — `npx astro preview`, порт 4321) і на ширині 1000px і 1280px перевірити:

```js
const inner = document.querySelector('.hdr__inner');
[inner.scrollWidth, inner.clientWidth, document.documentElement.scrollWidth, document.documentElement.clientWidth]
```
Expected: `scrollWidth === clientWidth` в обох парах — ні шапка, ні сторінка не переповнені.

Якщо переповнені: зменшити `gap` до `0.75rem` і `font-size` до `0.88rem`; якщо й цього мало — підняти межу з 1000px до 1100px і записати нове число в коментар у `Header.astro` і в `NavMenu.astro`.

**Після перевірки обовʼязково повернути `const nav = buildNav(show);`** і зібрати ще раз.

- [ ] **Step 12: Перевірити меню з клавіатури, без миші**

Це єдиний спосіб спіймати пастку фокуса — очима вона не видна. На ширині 390px, на `http://127.0.0.1:8788`:

У панелі зараз девʼять елементів, що приймають фокус: пʼять пунктів меню, телефон, дві соцмережі й політика. Адреса — абзац, вона фокус не приймає.

1. Tab до кнопки меню → `document.activeElement.id` = `nav-toggle`
2. Enter → `document.getElementById('nav-panel').dataset.open` = `'true'`, `document.getElementById('nav-toggle').getAttribute('aria-expanded')` = `'true'`, `document.activeElement.closest('#nav-panel') !== null` = `true`
3. Tab вісім разів (з першого елемента до девʼятого) → `document.activeElement.closest('#nav-panel') !== null` лишається `true` на кожному кроці
4. Ще один Tab з девʼятого елемента → фокус повернувся на перший пункт панелі, не вийшов назовні. Так само Shift+Tab з першого → на девʼятий
5. Escape → `dataset.open` = `'false'`, `aria-expanded` = `'false'`, `document.activeElement.id` = `'nav-toggle'`

Expected: усі пʼять пунктів як описано.

- [ ] **Step 13: Коміт**

```bash
git add src/lib/nav.ts src/components/NavMenu.astro src/components/Header.astro src/layouts/Base.astro src/pages/index.astro README.md
git commit -m "Бургер-меню з якорями і контактами, посилання в шапці від 1000px"
```

---

### Task 5: Приймання

Перевірки, які мають сенс тільки на готовому цілому. Нічого не реалізовує — якщо якийсь пункт падає, правка йде в той файл, де причина.

**Files:**
- Modify: нічого, крім виправлень за знайденим

**Interfaces:**
- Consumes: усе з Задач 1–4

- [ ] **Step 1: Запобіжник заглушок цілий**

Run: `npm run build`
Expected: **падає** з ненульовим кодом і перелічує чотири заглушки (телефон/Viber, Telegram, адреса, ФОП у політиці). Якщо збірка пройшла — запобіжник зламано, це помилка.

Run: `npm run build:preview`
Expected: успішно, `dist/` перезаписано.

- [ ] **Step 2: Бюджет швидкості**

Run: `npx lhci autorun --config=lighthouserc.json`
Expected: усі перевірки пройдені: performance ≥ 0.95, accessibility ≥ 0.95, seo = 1, LCP ≤ 2000 мс, CLS ≤ 0.02.

CLS тут головний ризик: шапка перемикає стан скриптом. Перемикання змінює лише кольори, розкладка стоїть на місці — якщо CLS зріс, шукати саме зсув від `margin-bottom` шапки або від `100svh`.

- [ ] **Step 3: Немає горизонтальної прокрутки від 320px**

На `http://127.0.0.1:8788`, ширина 320px:

```js
[document.documentElement.scrollWidth, document.documentElement.clientWidth]
```
Expected: два однакові числа. Повторити на 360px і 390px.

- [ ] **Step 4: Затемнення на відрендереній сторінці таке, як порахували**

Розрахунок у Задачі 2 виходив із значень токена. Тут перевіряється, що саме ці значення й доїхали до сторінки — між токеном і пікселем стоїть збірка, мінімізація CSS і каскад.

На `http://127.0.0.1:8788`:

```js
getComputedStyle(document.querySelector('.hero__scrim')).backgroundImage
```
Expected: градієнт із трьома зупинками `rgba(15, 23, 42, 0.82)`, `rgba(15, 23, 42, 0.68)`, `rgba(15, 23, 42, 0.78)` — ті самі числа, які отримали ≥ 4.5:1 у Задачі 2. Якщо значення інші — повторити розрахунок із фактичними.

Там же переконатися, що текст поверх нього справді білий:

```js
[getComputedStyle(document.querySelector('.hero__title')).color,
 getComputedStyle(document.querySelector('.hero__sub')).color]
```
Expected: обидва `rgb(255, 255, 255)`.

- [ ] **Step 5: Перший екран уміщається**

Ширина 360×640 — найтісніший реальний випадок. Специфікація прямо називає це ризиком: заголовок капсом плюс підзаголовок, дві кнопки й чіпи можуть не влізти в `100svh`.

```js
const hero = document.getElementById('hero');
const inner = hero.querySelector('.hero__inner');
[hero.getBoundingClientRect().height, inner.getBoundingClientRect().height, window.innerHeight]
```
Expected: висота вмісту менша за висоту вікна. Якщо ні — зменшувати в такому порядку: `gap` у `.hero__inner`, нижній `padding-block`, кегль заголовка. Чіпи прибирати останніми і тільки повідомивши про це: замовник просив подивитись саме з ними.

- [ ] **Step 6: Дві реакції на вихід першого екрана — разом**

Обидві стежать за одним і тим самим; полагодивши одну, легко зламати другу.

На ширині 390px прокрутити на півтори висоти вікна:

```js
window.scrollTo(0, window.innerHeight * 1.5);
// дати спостерігачам спрацювати, потім:
[document.querySelector('.hdr').dataset.solid,
 document.getElementById('sticky-call').dataset.visible]
```
Expected: `['true', 'true']` — шапка суцільна, нижня панель виїхала.

Потім `window.scrollTo(0, 0)` і те саме:
Expected: `['false', 'false']` — шапка прозора, панель прихована.

**Якщо в автоматизованому оточенні спостерігачі не спрацьовують** (у цьому проєкті таке вже було: harness не доставляв зворотні виклики `IntersectionObserver`) — не вважати це поломкою і не «лагодити» робочий код. Перевірити вручну на телефоні через тунель і записати результат у звіт саме як ручну перевірку.

- [ ] **Step 7: Привʼязка прокрутки**

На 390px: гортнути від першого екрана вниз — сторінка дощіпується до початку наступної секції. Далі гортати по довгих секціях («Питання і відповіді», «Контакти») — ніде не притягує й не залипає.

Далі увімкнути «зменшити рух» (у браузері — емуляція `prefers-reduced-motion: reduce`) і перевірити:

```js
getComputedStyle(document.documentElement).scrollSnapType
```
Expected: `none` — привʼязки немає зовсім.

**Safari на iPhone реалізує привʼязку по-своєму, і без живого пристрою ручатись за всі версії не можна.** Перевірити вручну через тунель: чи не бореться привʼязка з інерційною прокруткою, чи не смикає екран на межі першого екрана. Результат записати як ручну перевірку, з назвою моделі й версії iOS.

- [ ] **Step 8: Жодного зайвого кольору поза палітрою**

Run:
```bash
grep -rn "#[0-9a-fA-F]\{6\}\b" src/components src/layouts src/pages --include=*.astro | grep -v "src/layouts/Base.astro"
```
Expected: лише фірмові кольори чужих брендів — `#7360F2` і `#1088C6` у `SocialIcon.astro`, `Contacts.astro`, `StickyCall.astro`, `NavMenu.astro`, і кожен із коментарем поруч. Нічого іншого.

- [ ] **Step 9: Документація не розійшлася з кодом**

Run: `npm run validate`
Expected: код 0; у звіті лише чотири відомі заглушки. Перевірка шляхів з README (`scripts/validate-content.mjs`, блок 4) не скаржиться — отже нові файли `src/components/NavMenu.astro` і `src/lib/nav.ts` існують саме там, де їх обіцяє README.

- [ ] **Step 10: Коміт, якщо були правки**

```bash
git add -A
git commit -m "Правки за прийманням першого екрана й меню"
```

Якщо правок не було — коміта немає, і це нормальний результат.

---

## Що лишається поза цим планом

Не забути при звірці з замовником:

- **Фотографії першого екрана немає.** Фоном стоїть наявна графіка-заглушка. Підстановка знімка — заміна вмісту одного div (коментар у `Hero.astro` показує рівно, що вписати). Остаточний LCP міряється тільки на справжньому знімку: зараз найбільший елемент — текст, з фотографією найбільшою стане вона, і запас до 2000 мс зʼїсться.
- **Два тексти першого екрана — редакторські правки, що підлягають вичитці.** У заголовок додано «Києві та області» (село в `h1` віддавало б основний обсяг пошуку), у підзаголовок вставлено пропущене дієслово «дізнатися».
- **Чотири заглушки досі валять `npm run build`**: телефон, адреса, Telegram, дані ФОП. Це запобіжник, а не борг цього плану.
