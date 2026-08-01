import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const DEFAULT_SITE_URL = 'https://warrant.quantgems.com'

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const siteUrl = String(
    process.env.VITE_SITE_URL || fileEnv.VITE_SITE_URL || DEFAULT_SITE_URL,
  )
    .trim()
    .replace(/\/$/, '')

  return {
    plugins: [
      vue(),
      {
        name: 'inject-index-html-site-url',
        enforce: 'post',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            if (!html.includes('%VITE_SITE_URL%')) return html
            return html.split('%VITE_SITE_URL%').join(siteUrl)
          },
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.svg',
          'pwa-icon.svg',
          'pwa-icon-192.png',
          'pwa-icon-512.png',
          'og-image.png',
        ],
        manifest: {
          name: 'QuantGems 權證雷達',
          short_name: '權證雷達',
          description:
            '想快速鎖定台股權證？掃全市場認購／認售、追當日成交熱度，並以全螢幕 K 線與多空線檢視走勢。',
          theme_color: '#06121e',
          background_color: '#06121e',
          display: 'standalone',
          orientation: 'any',
          scope: '/',
          start_url: '/',
          lang: 'zh-TW',
          categories: ['finance', 'productivity'],
          icons: [
            {
              src: '/pwa-icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/pwa-icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          // StockChartECharts bundle 偏大
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico,webmanifest}'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cdn-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'font-cache',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
            {
              urlPattern: /\/api\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 5 },
                networkTimeoutSeconds: 10,
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    server: {
      port: 5180,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:5003',
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4180,
      strictPort: true,
    },
  }
})
