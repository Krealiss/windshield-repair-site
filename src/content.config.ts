import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Типізація контенту сайту: сторінки, послуги, галерея тощо.
 *
 * Розподіл відповідальності:
 *   validate-content.mjs → бізнес-правила, зрозумілі помилки українською,
 *                          блокування продакшн-збірки
 *   ці схеми             → типобезпека в шаблонах, автодоповнення,
 *                          падіння збірки при структурній невідповідності
 *
 * Дублювання тут навмисне: скрипт ловить «ціна 0», zod ловить
 * «ціна раптом стала рядком».
 */

const services = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/services' }),
  schema: z.object({
    title: z.string().min(1),
    price_from: z.number().int().positive(),
    duration_min: z.number().int().positive().optional(),
    note: z.string().max(90).optional(),
    order: z.number().int().default(10),
  }),
});

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/gallery' }),
  schema: ({ image }) =>
    z.object({
      before: image().optional(),
      after: image().optional(),
      damage_type: z.enum(['star', 'bullseye', 'combo', 'crack']),
      size_mm: z.number().int().min(1).max(50),
      duration_min: z.number().int().positive().optional(),
      published: z.boolean().default(false),
    }),
});

const reviews = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/reviews' }),
  schema: z.object({
    author: z.string().min(1),
    text: z.string().max(400),
    rating: z.number().int().min(1).max(5).default(5),
    date: z.coerce.date(),
    source: z.enum(['Google', 'Viber', 'Особисто']).optional(),
  }),
});

const faq = defineCollection({
  loader: glob({ pattern: '**/*.{yml,yaml}', base: './src/content/faq' }),
  schema: z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    in_schema: z.boolean().default(true),
    order: z.number().int().default(10),
  }),
});

export const collections = { services, gallery, reviews, faq };
