import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri expects a fixed dev port; failing loudly beats silently picking another one.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
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
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
