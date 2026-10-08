import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// HTTPS=1 (npm run dev:https -w @petmore/web) ใช้ทดสอบกล้องบนมือถือผ่าน Wi-Fi
// เบราว์เซอร์เปิดกล้องได้เฉพาะ https หรือ localhost
const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'brand/apple-touch-icon.png', 'brand/logo.png', 'brand/logo-sm.png'],
      manifest: {
        name: 'Petmore Magic Sale',
        short_name: 'Magic Sale',
        lang: 'th',
        start_url: '/',
        display: 'standalone',
        theme_color: '#241a3d',
        background_color: '#f5f2fb',
        // ไอคอนบนหน้าจอโฮมมือถือ/Handheld ใช้โลโก้ Petmore Magic Sale บนพื้นท้องฟ้ายามค่ำ
        icons: [
          { src: 'brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: { navigateFallbackDenylist: [/^\/api/], globPatterns: ['**/*.{js,css,html,svg,png}'] },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // ใช้ซอร์ส TypeScript ของ shared ตรงๆ แทน dist (CommonJS) ที่ Vite ต้อง pre-bundle เก็บ cache ไว้
      // เดิมแก้ shared แล้วหน้าเว็บพัง ("xxx is not a function") จนกว่าจะลบ node_modules/.vite ตอนนี้ HMR ได้ทันที
      '@petmore/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: true,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
});
