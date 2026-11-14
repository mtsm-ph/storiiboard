import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const E2E = process.env.STORIIBOARD_E2E === '1';

// A socket that never connects, never fails and never says anything: what the test server's page gets in place of
// Vite's hot-reload socket.
const QUIET_SOCKET = `class QuietSocket {
  readyState = 0;
  OPEN = 1;
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}
`;

/**
 * The end-to-end tests' server opens no socket to the page (Kevin, Nov 11). `hmr: false` alone stops the hot
 * updates, but Vite's client still connects to the server, and that connection's refusals when a page closes or the
 * server is busy were console errors the tests caught now and then. So, for the test server only, the client is
 * served with its socket swapped for one that does nothing: there is no connection to fail, and no console error is
 * filtered. If a Vite update moves the socket, the client fails to load and e2e/shell.spec.ts's test of this fails,
 * rather than the socket quietly coming back.
 */
function noDevSocket(): Plugin {
  return {
    name: 'storiiboard:no-dev-socket',
    apply: 'serve',
    transform(code, id) {
      if (!/\/vite\/dist\/client\/client\.mjs$/.test(id.replace(/\\/g, '/').replace(/\?.*$/, ''))) return null;
      if (!code.includes('new WebSocket(')) this.error("Vite's client no longer opens its socket where noDevSocket expects it.");
      return { code: QUIET_SOCKET + code.replaceAll('new WebSocket(', 'new QuietSocket('), map: null };
    },
  };
}

// Tauri expects a fixed dev port; failing loudly beats silently picking another one.
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(E2E ? [noDevSocket()] : [])],
  clearScreen: false,
  server: {
    // The end-to-end tests run their own server on another port (playwright.config.ts), so one already running for `npm run
    // dev` or `tauri dev` is never reused with hot reload on.
    port: Number(process.env.STORIIBOARD_PORT) || 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
    // No hot reload for the end-to-end tests' server (Playwright's web server sets STORIIBOARD_E2E), and no socket at
    // all (noDevSocket, above). Everyday dev is unchanged.
    ...(E2E ? { hmr: false } : {}),
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
