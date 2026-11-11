import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri expects a fixed dev port; failing loudly beats silently picking another one.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    // The end-to-end tests run their own server on another port (playwright.config.ts), so one already running for `npm run
    // dev` or `tauri dev` is never reused with hot reload on.
    port: Number(process.env.STORIIBOARD_PORT) || 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    // The end-to-end tests catch console errors, and the hot-reload socket's refusals when a server restarts or closes were
    // one: Playwright's web server sets this, so tests have no such socket. Everyday dev is unchanged.
    ...(process.env.STORIIBOARD_E2E === '1' ? { hmr: false } : {}),
    // Compile the app and the lazy-loaded catalogue as the server starts, so the first page a test opens doesn't
    // wait for them. On a busy machine that wait alone was enough to time a test out.
    warmup: { clientFiles: ['./src/main.tsx', './src/app/catalogue/Catalogue.tsx'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // Safari 16 is the oldest WKWebView a supported macOS ships; Edge WebView2 is evergreen.
    target: ['safari16', 'chrome120'],
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    environment: 'node',
    // The JSON report keeps every failed test's name (3.19): `npm run failed-tests` lists them, and CI keeps the file.
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/unit.json' },
  },
});
