import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Theme colors mirror --bg in src/styles/tokens.css (light / dark).
const THEME_LIGHT = '#f7f7f4';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      // Registered from main.tsx via `virtual:pwa-register` (production only), so no inline
      // registration script is injected and the CSP can stay script-src 'self' (R8).
      injectRegister: false,
      registerType: 'autoUpdate',
      // public/ files are already matched by workbox.globPatterns; don't list them twice.
      includeAssets: [],
      includeManifestIcons: false,
      manifest: {
        name: 'Flip it or Rip it',
        short_name: 'Flip or Rip',
        description: 'Scan or type an item and find out whether it is worth selling.',
        lang: 'en',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: THEME_LIGHT,
        background_color: THEME_LIGHT,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is precached. The scanner chunk and the decoder are not: they are
        // runtime-cached on first use (R9), so the typing path never pays for them.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,txt}'],
        globIgnores: ['**/assets/scanner-*.js', '**/assets/ponyfill-*.js', '**/assets/*.wasm'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        runtimeCaching: [
          // A stale valuation must never masquerade as live.
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
          {
            urlPattern: ({ url }) => /\/assets\/(scanner|ponyfill)-[^/]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'scanner-js', expiration: { maxEntries: 8 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'scanner-wasm', expiration: { maxEntries: 2 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://api:3000',
      '/health': 'http://api:3000',
    },
  },
  preview: { host: true, port: 4173 },
  build: {
    manifest: true,
    target: 'es2022',
    // The decoder wasm must be a hashed file on our own origin, never inlined as base64.
    assetsInlineLimit: (file) => (file.endsWith('.wasm') ? false : undefined),
  },
});
