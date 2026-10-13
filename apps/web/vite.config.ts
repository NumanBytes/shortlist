/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Our own service worker (src/sw/sw.ts): it handles Web Push as well as the offline app
      // shell (docs/notifications.md §19.5). The plugin injects the precache manifest into it.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Shortlist',
        short_name: 'Shortlist',
        description: 'Finds jobs worth your time and tailors a truthful resume for each.',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // Full-bleed, mark inside the safe zone: Android crops maskable icons to its own shape.
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Cache the app shell only (the /api exclusion is in sw.ts). pdf.js (resume import only,
      // ~1.5 MB) is fetched when used, not precached on every phone.
      injectManifest: { globIgnores: ['**/pdf*.js', '**/pdf*.mjs'] },
    }),
  ],
  server: {
    // Same-origin in development: the browser only ever talks to :5173, and Vite
    // forwards /api to Nest. That's what lets the SameSite=Strict refresh cookie work
    // locally without CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
