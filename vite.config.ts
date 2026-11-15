import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { CSP_VIOLATION_PREFIX, e2eCsp, tauriCsp } from './scripts/e2eCsp';

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

const CSP_WATCH = '/@storiiboard/csp-watch.js';
const CSP_REPORT = '/@storiiboard/csp-violation';

// Loaded first on the test server's page: every violation of the policy is printed to the console (e2e/cspWatch.ts
// fails the test on it), kept for violations before a test listens, and sent to the server's log, where Playwright
// shows it ("[WebServer] …") whichever test it came from.
const CSP_WATCH_SCRIPT = `(() => {
  const seen = (window.__cspViolations = []);
  document.addEventListener('securitypolicyviolation', (event) => {
    const where = event.sourceFile ? ' from ' + event.sourceFile + ':' + event.lineNumber : '';
    const line = ${JSON.stringify(CSP_VIOLATION_PREFIX)} + ' ' + event.effectiveDirective + ' refused ' + (String(event.blockedURI).slice(0, 120) || '(none)') + where;
    seen.push(line);
    console.error(line);
    navigator.sendBeacon(${JSON.stringify(CSP_REPORT)}, line + ' on ' + location.pathname);
  });
})();
`;

/**
 * The end-to-end tests' page runs under the installed app's CSP (6.13), so what the app refuses fails a test rather
 * than an installer. Read from src-tauri/tauri.conf.json as the server starts, plus only the test build's additions
 * (scripts/e2eCsp.ts), sent as a header on the page, as Tauri does. Test server only: everyday dev is unchanged.
 */
function e2eContentSecurityPolicy(): Plugin {
  const policy = e2eCsp(tauriCsp(import.meta.dirname));
  return {
    name: 'storiiboard:e2e-csp',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.replace(/\?.*$/, '');
        if (path === CSP_WATCH) {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(CSP_WATCH_SCRIPT);
          return;
        }
        if (path === CSP_REPORT && req.method === 'POST') {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (chunk: string) => (body += chunk.slice(0, 1000)));
          req.on('end', () => {
            process.stderr.write(`${body.slice(0, 1000)}\n`);
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        // The page and any frame: what a browser asks for as a document. Scripts and workers carry no policy of their
        // own, as in the app.
        if (req.headers.accept?.includes('text/html')) res.setHeader('Content-Security-Policy', policy);
        next();
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler: () => [{ tag: 'script', attrs: { src: CSP_WATCH }, injectTo: 'head-prepend' }],
    },
  };
}

// Tauri expects a fixed dev port; failing loudly beats silently picking another one.
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(E2E ? [noDevSocket(), e2eContentSecurityPolicy()] : [])],
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
