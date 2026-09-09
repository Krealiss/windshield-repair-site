#!/usr/bin/env node
/**
 * Перевірка контенту перед збіркою.
 *
 *   node scripts/validate-content.mjs            → прев'ю: ніколи не падає
 *   node scripts/validate-content.mjs --prod     → продакшн: падає на помилках
 *
 * Помилки (ERROR) блокують продакшн-збірку.
 * Попередження (WARN) не блокують, але означають, що блок не відрендериться.
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

// ── 1. КОНТАКТИ ───────────────────────────────────────────
const contacts = await readYaml(join(ROOT, 'contacts.yml'));

if (!contacts) {
  err('contacts.yml', 'файл відсутній');
} else {
  const phone = String(contacts.phone_main ?? '').trim();
  if (!phone) {
    err('contacts.phone_main', 'основний телефон порожній — сайт без конверсії');
  } else if (!/^\+380\d{9}$/.test(phone)) {
    err('contacts.phone_main', `невірний формат "${phone}", очікується +380XXXXXXXXX`);
  }

  const track = String(contacts.phone_tracking ?? '').trim();
  if (track && !/^\+380\d{9}$/.test(track)) {
    err('contacts.phone_tracking', `невірний формат "${track}"`);
  }

  if (!String(contacts.address ?? '').trim()) {
    err('contacts.address', 'адреса порожня, але сторінка має карту');
  }
  for (const k of ['lat', 'lng']) {
    if (typeof contacts[k] !== 'number' || Number.isNaN(contacts[k])) {
      err(`contacts.${k}`, 'координата відсутня — карта і schema.org зламаються');
    }
  }
  if (!Array.isArray(contacts.hours) || contacts.hours.length === 0) {
    warn('contacts.hours', 'графік не заповнений — блок не відрендериться');
  }
}

// ── 2. ПОСЛУГИ ────────────────────────────────────────────
const services = await readCollection('services');

if (services.length === 0) {
  err('services', 'немає жодної послуги — блок цін порожній');
}
for (const s of services) {
  if (!String(s.title ?? '').trim()) err(s._file, 'назва порожня');
  if (!Number.isInteger(s.price_from) || s.price_from <= 0) {
    err(s._file, `ціна відсутня або некоректна (${s.price_from})`);
  }
  if (s.note && String(s.note).length > 90) {
    warn(s._file, `примітка ${String(s.note).length} символів, ліміт 90 — обріжеться`);
  }
}

// ── 3. ГАЛЕРЕЯ ────────────────────────────────────────────
const gallery = await readCollection('gallery');
const published = gallery.filter((g) => g.published === true);

for (const g of published) {
  for (const side of ['before', 'after']) {
    const src = g[side];
    if (!src) {
      err(g._file, `опубліковано, але немає фото "${side}" — заглушка в продакшні`);
      continue;
    }

    // Astro резолвить image() відносно самого файлу запису. Абсолютний шлях
    // він вважає посиланням у public/ і збірка падає з ImageNotFound.
    // Такий шлях означає, що в public/admin/config.yml зіпсували public_folder.
    if (String(src).startsWith('/')) {
      err(
        g._file,
        `${side}: абсолютний шлях "${src}" — Astro його не знайде. ` +
          'Очікується відносний, напр. ../../assets/gallery/foto.webp. ' +
          'Перевірте public_folder у public/admin/config.yml'
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

// ── 4. ВІДГУКИ ────────────────────────────────────────────
const reviews = await readCollection('reviews');
for (const r of reviews) {
  if (String(r.text ?? '').length > 400) {
    warn(r._file, `відгук ${String(r.text).length} символів, ліміт 400 — зламає сітку`);
  }
}
if (reviews.length < 3) {
  warn('reviews', `${reviews.length} відгуків із мінімальних 3 — блок приховано`);
}

// ── 5. СТОРІНКИ ТА SEO ────────────────────────────────────
for (const page of ['home', 'mobile']) {
  const p = await readYaml(join(ROOT, 'pages', `${page}.yml`));
  if (!p) {
    err(`pages/${page}.yml`, 'файл відсутній');
    continue;
  }
  if (!String(p.seo_title ?? '').trim()) {
    err(`pages/${page}.seo_title`, 'порожній заголовок для пошуку');
  } else if (p.seo_title.length > 60) {
    warn(`pages/${page}.seo_title`, `${p.seo_title.length} символів — Google обріже після 60`);
  }
  if (!String(p.seo_description ?? '').trim()) {
    warn(`pages/${page}.seo_description`, 'порожній опис — Google згенерує свій');
  } else if (p.seo_description.length > 155) {
    warn(`pages/${page}.seo_description`, `${p.seo_description.length} символів, ліміт 155`);
  }
  if (!String(p.h1 ?? '').trim()) err(`pages/${page}.h1`, 'порожній головний заголовок');
}

// ── 6. ЗОНА ВИЇЗДУ ────────────────────────────────────────
const coverage = await readYaml(join(ROOT, 'coverage.yml'));
if (coverage) {
  if (!Array.isArray(coverage.areas) || coverage.areas.length === 0) {
    warn('coverage.areas', 'не вказано жодного району — сторінка виїзду без географії');
  }
  if (!Number.isInteger(coverage.travel_fee)) {
    err('coverage.travel_fee', 'вартість виїзду не вказана (0 = безкоштовно)');
  }
}

// ── 7. ДЕМОНСТРАЦІЙНІ ЗАГЛУШКИ ────────────────────────────
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
    file: 'public/admin/config.yml',
    find: 'auth.example.workers.dev',
    what: 'адреса OAuth-воркера з шаблону — вхід у CMS не спрацює',
  },
  {
    file: 'public/admin/config.yml',
    find: 'OWNER/REPO',
    what: 'репозиторій не вказано — CMS не знатиме, куди зберігати правки',
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
  `\nСтатистика: послуг ${services.length}, ` +
    `пар у галереї ${published.length}/${gallery.length}, ` +
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
