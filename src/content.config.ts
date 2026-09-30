import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Типізація контенту сайту: галерея, відгуки, питання і відповіді.
 *
 * Розподіл відповідальності:
 *   ці схеми             → типи, обовʼязковість полів і межі значень
 *                          (`size_mm` — 1..50, `text` — до 400 символів).
 *                          Плюс типобезпека в шаблонах і автодоповнення.
 *                          Падають під час збірки.
 *   validate-content.mjs → те, чого схеми не вміють: заглушки з шаблону,
 *                          фотографії галереї (чи є файл на диску, чи
 *                          правильний шлях, чи достатній розмір) і пороги
 *                          показу блоків.
 *
 * Дублювання між ними прибрано: правило, яке можна виразити типом,
 * живе тут і тільки тут.
 */

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
    /*
      Вигаданий відгук, який стоїть, поки немає справжніх: блок видно
      локально, а `npm run build` на ньому падає — так само, як на
      демонстраційному телефоні чи адресі.

      Окреме поле, а не «здогадатися за іменем файлу»: у продакшн такий
      відгук не має поїхати навіть перейменованим. І в агрегований
      рейтинг для Google демонстраційні не потрапляють узагалі
      (SchemaOrg.astro) — вигадані зірки в розмітці означають ручну
      санкцію на весь домен.
    */
    demo: z.boolean().default(false),
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

export const collections = { gallery, reviews, faq };
