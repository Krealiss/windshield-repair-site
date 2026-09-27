import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'astro:content';
import { getCollection } from 'astro:content';

/**
 * Єдина точка доступу до даних сайту.
 * Компоненти сюди не лізуть — сторінка викликає loadSite() і роздає пропси.
 */

// ── singleton-файли (не колекції) ─────────────────────────
const contactsSchema = z.object({
  phone_main: z.string().regex(/^\+380\d{9}$/),
  phone_tracking: z.string().regex(/^\+380\d{9}$/).optional().or(z.literal('')),
  viber: z.string().optional(),
  telegram: z.string().optional(),
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  hours: z
    .array(
      z.object({
        day: z.string(),
        from: z.string().optional(),
        to: z.string().optional(),
        closed: z.boolean().default(false),
      })
    )
    .default([]),
});

const coverageSchema = z.object({
  areas: z.array(z.string()).default([]),
  travel_fee: z.number().int().min(0),
  radius_km: z.number().int().optional(),
  conditions: z.string().optional(),
});

const pageSchema = z.object({
  seo_title: z.string().min(1).max(60),
  seo_description: z.string().max(155),
  h1: z.string().min(1),
  hero_subtitle: z.string().optional(),
  guarantee: z.string().optional(),
});

function loadYaml<T extends z.ZodTypeAny>(path: string, schema: T): z.infer<T> {
  const raw = parse(readFileSync(path, 'utf8'));
  const result = schema.safeParse(raw);
  if (!result.success) {
    // Збірка має падати тут, а не рендерити undefined у шаблон
    throw new Error(
      `Некоректний контент у ${path}:\n${JSON.stringify(result.error.issues, null, 2)}`
    );
  }
  return result.data;
}

// ── пороги показу блоків ──────────────────────────────────
const MIN_GALLERY_PAIRS = 4;
const MIN_REVIEWS = 3;

export type PageKey = 'home' | 'mobile';

export async function loadSite(page: PageKey) {
  const contacts = loadYaml('./src/content/contacts.yml', contactsSchema);
  const coverage = loadYaml('./src/content/coverage.yml', coverageSchema);
  const meta = loadYaml(`./src/content/pages/${page}.yml`, pageSchema);

  // Опублікована пара без обох фото не показується ніколи —
  // навіть якщо валідатор чомусь пропустили
  const pairs = (await getCollection('gallery')).filter(
    (g) => g.data.published && g.data.before && g.data.after
  );

  const reviews = (await getCollection('reviews')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  );

  const faq = (await getCollection('faq')).sort((a, b) => a.data.order - b.data.order);

  return {
    contacts,
    coverage,
    meta,
    gallery: pairs.map((g) => g.data),
    reviews: reviews.map((r) => r.data),
    faq: faq.map((f) => f.data),

    // Телефон для показу: трекінговий має пріоритет
    phone: contacts.phone_tracking || contacts.phone_main,

    // Блоки, які рендеряться умовно
    show: {
      gallery: pairs.length >= MIN_GALLERY_PAIRS,
      reviews: reviews.length >= MIN_REVIEWS,
      hours: contacts.hours.length > 0,
      coverage: coverage.areas.length > 0,
    },
  };
}

export type SiteData = Awaited<ReturnType<typeof loadSite>>;
