import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSP_VIOLATIONS_FILE, unexpectedViolations } from '../scripts/e2eCsp';

/**
 * The run's global teardown (6.13 review): fails the run on any violation that this run's test server was told of,
 * from every spec, whether it calls skipOnboarding or not, of either policy: the installed app's page policy
 * (src-tauri/tauri.conf.json), reported by each page, and the workers' policy (src-tauri/worker-csp.txt, Nov 19),
 * reported by the browser through its report-uri. The meant ones are left out (scripts/e2eCsp.ts,
 * isExpectedViolation): the data: fetch e2e/shell.spec.ts makes by its page's address, and the probe worker's eval,
 * Function and fetch (e2e/workerCsp.spec.ts) by the probe's own address. Each shard has its own server, which empties
 * the file as it starts; only reports from this run on are read (a server reused from an earlier run keeps its older
 * ones).
 */
export default function cspTeardown(): void {
  const file = join(import.meta.dirname, '..', CSP_VIOLATIONS_FILE);
  if (!existsSync(file)) return;
  const since = Number(process.env.SB_E2E_RUN_STARTED ?? 0);
  const found = unexpectedViolations(readFileSync(file, 'utf8'), since);
  if (found.length === 0) return;
  throw new Error(
    `The pages or their workers broke the installed app’s content security policies ${String(found.length)} time(s) in ` +
      'this run: the page’s is src-tauri/tauri.conf.json (app.security.csp), the workers’ is src-tauri/worker-csp.txt ' +
      '(a line whose document is a worker’s script, or whose source is one, is the workers’):\n' +
      found.map((line) => `  ${line}`).join('\n'),
  );
}
