import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServerResponse } from 'node:http';
import {
  CSP_REPORT_PATH,
  CSP_VIOLATION_PREFIX,
  CSP_VIOLATIONS_FILE,
  cspReportLines,
  e2eCsp,
  e2eWorkerCsp,
  isJavaScript,
  tauriCsp,
  workerCsp,
  writeHeadHeader,
} from './scripts/e2eCsp';

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
const CSP_REPORT = CSP_REPORT_PATH;

/** Most of a report read, however much is sent: a browser's JSON report runs longer than the page's one line. */
const REPORT_READ_MAX = 4000;

/**
 * The worker policy on a JavaScript response, as the app sends it on its .js and .mjs assets (src-tauri/src/
 * worker_csp.rs): on a page's script a browser ignores it, on a worker's it is that worker's policy. Set as the
 * response's head goes out, since only then is its Content-Type known (Vite's own handlers set it, or a static file's
 * writeHead carries it); a response that already has a policy keeps it.
 */
function sendWorkerPolicy(res: ServerResponse, policy: string): void {
  const writeHead = res.writeHead.bind(res);
  res.writeHead = function (...args: unknown[]) {
    // Set on the response already, or given to writeHead as an object or as Node's raw array (scripts/e2eCsp.ts).
    const named = (name: string) => res.getHeader(name) ?? writeHeadHeader(args, name);
    const type = named('content-type');
    if (typeof type === 'string' && isJavaScript(type) && named('content-security-policy') === undefined) {
      res.setHeader('Content-Security-Policy', policy);
    }
    return Reflect.apply(writeHead, res, args) as ServerResponse;
  };
}

// Loaded first on the test server's page: every violation of the policy is printed to the console (e2e/cspWatch.ts
// fails the test on it), kept for violations before a test listens, and sent to the server, which prints it to its log
// (Playwright shows it as "[WebServer] …") and keeps it in a file the run's teardown reads (e2e/cspTeardown.ts),
// whichever test it came from. The report names the page's address, query included, so a meant one is known by it.
const CSP_WATCH_SCRIPT = `(() => {
  const seen = (window.__cspViolations = []);
  document.addEventListener('securitypolicyviolation', (event) => {
    const where = event.sourceFile ? ' from ' + event.sourceFile + ':' + event.lineNumber : '';
    const line = ${JSON.stringify(CSP_VIOLATION_PREFIX)} + ' ' + event.effectiveDirective + ' refused ' + (String(event.blockedURI).slice(0, 120) || '(none)') + where;
    seen.push(line);
    console.error(line);
    navigator.sendBeacon(${JSON.stringify(CSP_REPORT)}, line + ' on ' + location.pathname + location.search);
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
  const workerPolicy = e2eWorkerCsp(workerCsp(import.meta.dirname));
  const violations = join(import.meta.dirname, CSP_VIOLATIONS_FILE);
  return {
    name: 'storiiboard:e2e-csp',
    apply: 'serve',
    configureServer(server) {
      // Emptied as the server starts: what the file holds is this server's.
      mkdirSync(dirname(violations), { recursive: true });
      writeFileSync(violations, '');
      server.middlewares.use((req, res, next) => {
        const path = req.url?.replace(/\?.*$/, '');
        sendWorkerPolicy(res, workerPolicy);
        if (path === CSP_WATCH) {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(CSP_WATCH_SCRIPT);
          return;
        }
        if (path === CSP_REPORT && req.method === 'POST') {
          let body = '';
          req.setEncoding('utf8');
          // At most REPORT_READ_MAX characters read and 1000 kept per line, however much is sent; a broken request ends
          // without a report. The page's line is kept as it is; a browser's JSON report (a worker's, through its
          // policy's report-uri) is turned into the same line (scripts/e2eCsp.ts, cspReportLines).
          req.on('data', (chunk: string) => (body = (body + chunk).slice(0, REPORT_READ_MAX)));
          req.on('error', () => res.destroy());
          req.on('end', () => {
            const at = Date.now();
            for (const line of cspReportLines(body)) {
              process.stderr.write(`${line}\n`);
              appendFileSync(violations, `${JSON.stringify({ at, line })}\n`);
            }
            res.statusCode = 204;
            res.end();
          });
          return;
        }
        // The page and any frame: what a browser asks for as a document. Scripts get the worker policy instead
        // (sendWorkerPolicy, above), as in the app.
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
