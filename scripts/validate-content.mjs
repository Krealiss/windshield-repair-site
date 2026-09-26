#!/usr/bin/env node
/**
 * Перевірка контенту перед збіркою.
 *
 *   node scripts/validate-content.mjs            → прев'ю: ніколи не падає
 *   node scripts/validate-content.mjs --prod     → продакшн: падає на помилках
 *
 * Помилки (ERROR) блокують продакшн-збірку.
 * Попередження (WARN) не блокують, але означають, що блок не відрендериться.
 *
 * Перевіряє тільки те, чого не робить zod:
 *   — заглушки з шаблону (домен, телефон, адреса, реквізити ФОП)
 *   — фотографії галереї: чи існує файл, чи правильний шлях, чи достатня ширина
 *   — пороги показу блоків (галерея від 4 пар, відгуки від 3)
 *
 * Решту — типи, обовʼязковість полів, межі значень — описують схеми
 * в src/content.config.ts і src/lib/site.ts.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parse } from 'yaml';

const ROOT = 'src/content';
const MEDIA = 'src/assets/gallery';
const PROD = process.argv.includes('--prod');

const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warns.push(`${where}: ${msg}`);

// ── читання ───────────────────────────────────────────────
async function readYaml(path) {
  if (!existsSync(path)) return null;
  try {
    return parse(await readFile(path, 'utf8')) ?? {};
  } catch (e) {
    err(path, `не читається як YAML — ${e.message}`);
    return null;
  }
}

async function readCollection(name) {
  const dir = join(ROOT, name);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) =>
    ['.yml', '.yaml', '.md', '.json'].includes(extname(f))
  );
  const out = [];
  for (const f of files) {
    const data = await readYaml(join(dir, f));
    if (data) out.push({ _file: `${name}/${f}`, ...data });
  }
  return out;
}

// ── ширина зображення (sharp опційний) ────────────────────
let sizeOf = null;
try {
  const sharp = (await import('sharp')).default;
  sizeOf = async (p) => {
    const m = await sharp(p).metadata();
    return m.width ?? 0;
  };
} catch {
  /* sharp немає — перевірку ширини пропускаємо */
}

// ── 1. ГАЛЕРЕЯ ────────────────────────────────────────────
const gallery = await readCollection('gallery');
const published = gallery.filter((g) => g.published === true);

for (const g of published) {
  for (const side of ['before', 'after']) {
    const src = g[side];
    if (!src) {
      err(g._file, `опубліковано, але немає фото "${side}" — заглушка в продакшні`);
      continue;
    }

    // Astro резолвить image() або від кореня проєкту ("/src/..."), або
    // відносно самого файлу запису ("../../"). Шлях на кшталт
    // "/assets/gallery/foto.webp" він вважає посиланням у public/,
    // не знаходить файл і валить збірку з ImageNotFound.
    if (String(src).startsWith('/') && !String(src).startsWith('/src/')) {
      err(
        g._file,
        `${side}: шлях "${src}" Astro не знайде — він шукатиме файл у public/. ` +
          'Очікується /src/assets/gallery/foto.webp.'
      );
      continue;
    }

    const path = join(MEDIA, String(src).split('/').pop());
    if (!existsSync(path)) {
      err(g._file, `файл ${src} не знайдено на диску`);
    } else if (sizeOf) {
      const w = await sizeOf(path);
      if (w < 1200) warn(g._file, `${side}: ширина ${w}px, потрібно від 1200px`);
    }
  }
  if (!Number.isInteger(g.size_mm)) {
    warn(g._file, 'не вказано розмір у мм — підпис буде неповним');
  }
}

if (published.length < 4) {
  warn(
    'gallery',
    `опубліковано ${published.length} пар із мінімальних 4 — блок галереї приховано`
  );
}

// ── 2. ВІДГУКИ: лише поріг показу ─────────────────────────
// Довжину тексту перевіряє zod (.max(400) у content.config.ts)
const reviews = await readCollection('reviews');
if (reviews.length < 3) {
  warn('reviews', `${reviews.length} відгуків із мінімальних 3 — блок приховано`);
}

// ── 3. ДЕМОНСТРАЦІЙНІ ЗАГЛУШКИ ────────────────────────────
/**
 * Заглушки з шаблону, які легко не помітити: вони не ламають збірку,
 * сайт із ними виглядає працездатним — і саме тому їдуть у продакшн.
 * Ціна помилки різна: неправильний домен ламає canonical, sitemap і
 * schema.org одразу для всіх сторінок, а чужий телефон означає, що
 * кожен дзвінок із сайту йде повз власника.
 *
 * У прев'ю це лише попередження — розробляти з example.com.ua нормально.
 */
const PLACEHOLDERS = [
  {
    file: 'astro.config.mjs',
    find: 'example.com.ua',
    what: 'домен із шаблону в site: — canonical, sitemap і schema.org вкажуть у нікуди',
  },
  {
    file: 'public/robots.txt',
    find: 'example.com.ua',
    what: 'домен із шаблону в рядку Sitemap: — пошуковики не знайдуть карту сайту',
  },
  {
    file: 'src/content/contacts.yml',
    find: '+380671234567',
    what: 'демонстраційний телефон — усі кнопки дзвінка ведуть не власнику',
  },
  {
    file: 'src/content/contacts.yml',
    find: 'Хрещатик 12',
    what: 'демонстраційна адреса — потрапить у schema.org і в посилання на карти',
  },
  {
    file: 'src/pages/polityka-konfidentsiynosti.astro',
    find: 'ПРІЗВИЩЕ ІМЯ',
    what: 'не вказано володільця даних — без назви ФОП чи ТОВ політика юридично порожня',
  },
];

for (const p of PLACEHOLDERS) {
  if (!existsSync(p.file)) continue;
  const text = await readFile(p.file, 'utf8');
  if (!text.includes(p.find)) continue;
  const msg = `лишилася заглушка "${p.find}" — ${p.what}`;
  if (PROD) err(p.file, msg);
  else warn(p.file, msg);
}

// ── звіт ──────────────────────────────────────────────────
const line = '─'.repeat(58);
console.log(`\n${line}\nПеревірка контенту — режим: ${PROD ? 'ПРОДАКШН' : "прев'ю"}\n${line}`);

if (warns.length) {
  console.log(`\n⚠  Попередження (${warns.length}):`);
  warns.forEach((w) => console.log(`   ${w}`));
}
if (errors.length) {
  console.log(`\n✖  Помилки (${errors.length}):`);
  errors.forEach((e) => console.log(`   ${e}`));
}
if (!warns.length && !errors.length) {
  console.log('\n✓  Контент коректний.');
}

console.log(
  `\nСтатистика: пар у галереї ${published.length}/${gallery.length}, ` +
    `відгуків ${reviews.length}\n`
);

if (errors.length && PROD) {
  console.error('Продакшн-збірка зупинена. Виправте помилки вище.\n');
  process.exit(1);
}
if (errors.length) {
  console.log("Прев'ю-збірка продовжується попри помилки.\n");
}
process.exit(0);
