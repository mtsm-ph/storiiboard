import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSP_VIOLATIONS_FILE, unexpectedViolations } from '../scripts/e2eCsp';

/**
 * The run's global teardown (6.13 review): fails the run on any violation of the installed app's content security
 * policy that any page of this run's test server reported, from every spec, whether it calls skipOnboarding or not.
 * The one e2e/shell.spec.ts causes on purpose is left out by its page's address (scripts/e2eCsp.ts). Each shard has its
 * own server, which empties the file as it starts; only reports from this run on are read (a server reused from an
 * earlier run keeps its older ones).
 */
export default function cspTeardown(): void {
  const file = join(import.meta.dirname, '..', CSP_VIOLATIONS_FILE);
  if (!existsSync(file)) return;
  const since = Number(process.env.SB_E2E_RUN_STARTED ?? 0);
  const found = unexpectedViolations(readFileSync(file, 'utf8'), since);
  if (found.length === 0) return;
  throw new Error(
    `The pages broke the installed app’s content security policy (src-tauri/tauri.conf.json) ${String(found.length)} ` +
      `time(s) in this run:\n${found.map((line) => `  ${line}`).join('\n')}`,
  );
}
