import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://avtoskloua.com',

  // Один канонічний варіант URL. Без цього /thanks і /thanks/
  // стануть двома сторінками з однаковим вмістом.
  trailingSlash: 'always',
  build: { format: 'directory' },

  compressHTML: true,

  // Префетч вимкнено навмисно: сайт односторінковий, людина й так на
  // потрібній сторінці. Префетч тут витрачав би чужий трафік дарма.
  prefetch: false,

  integrations: [
    sitemap({
      filter: (page) => !page.includes('/thanks'),
      changefreq: 'monthly',
      lastmod: new Date(),
    }),
  ],

  image: {
    // Формати за спаданням пріоритету — браузер бере перший підтримуваний
    service: { entrypoint: 'astro/assets/services/sharp' },
  },

  vite: {
    build: {
      // Бюджет: попередження вже на 25 КБ, щоб зростання помітили одразу
      chunkSizeWarningLimit: 25,
    },
  },
});
