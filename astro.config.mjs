import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://example.com.ua',   // ← замінити на реальний домен

  // Один канонічний варіант URL. Без цього /vyizdnyi-remont і
  // /vyizdnyi-remont/ стануть двома сторінками з однаковим вмістом.
  trailingSlash: 'always',
  build: { format: 'directory' },

  compressHTML: true,

  // Префетч вимкнено навмисно: сторінок дві, людина майже завжди
  // читає одну і дзвонить. Префетч тут витрачав би чужий трафік дарма.
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
