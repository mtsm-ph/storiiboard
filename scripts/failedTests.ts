// Every test that failed in a run, flaky ones included, by name (3.19, Kevin Nov 9): read from Vitest's JSON report
// (test-results/unit.json) and Playwright's (test-results/e2e.json), so a report to Kevin names each one rather than
// a count. A test Playwright passed only on its retry is flaky, and listed: a flake is a failure that hid.
//
//   npm run failed-tests                        both reports from the last local run
//   node scripts/failedTests.ts path/to/e2e.json one report (a CI artifact, say)
//
// Prints when each run started and a line saying so when none failed. Exits 1 when no report is found or one can't be
// read, so a missing report is never mistaken for a clean run. Each run rewrites its report, a rerun of one file
// too: run this right after the full run, before any rerun. One thing it can't see: an error Vitest reports outside
// every test file (an unhandled rejection), which its report leaves out; a red `npm test` with nothing listed is that,
// in the log. Plain TypeScript Node runs as is (type stripping, Node 22.18 and later): no enums.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface FailedTest {
  kind: 'failed' | 'flaky';
  name: string;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: Json | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: Json | undefined): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);
const text = (value: Json | undefined): string => (typeof value === 'string' ? value : '');

/** A path from the repo's root, with forward slashes, whatever machine wrote it. */
function fromRoot(path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const at = slashed.search(/(^|\/)(src|e2e|scripts)\//);
  return at < 0 ? slashed : slashed.slice(slashed[at] === '/' ? at + 1 : at);
}

/** Vitest's JSON report (Jest's shape): each file's assertions with their status. */
export function vitestFailures(report: JsonObject): FailedTest[] {
  const out: FailedTest[] = [];
  for (const file of list(report.testResults)) {
    const path = fromRoot(text(file.name));
    const tests = list(file.assertionResults);
    let named = false;
    for (const test of tests) {
      if (test.status !== 'failed') continue;
      const titles = [...(Array.isArray(test.ancestorTitles) ? test.ancestorTitles.map(text) : []), text(test.title)];
      out.push({ kind: 'failed', name: `${path} › ${titles.join(' › ')}` });
      named = true;
    }
    // A file can fail with no test failed: it didn't load (no tests at all), or a hook threw (a beforeAll skips every
    // test; an afterAll fails the file after they passed). Its message says why.
    if (file.status === 'failed' && !named) {
      const why = firstLine(file.message);
      out.push({ kind: 'failed', name: tests.length === 0 ? `${path} (didn't load${why ? `: ${why}` : ''})` : `${path} (failed outside a test${why ? `: ${why}` : ''})` });
    }
  }
  return out;
}

const firstLine = (value: Json | undefined): string => text(value).split('\n')[0]?.trim() ?? '';

/** Playwright's JSON report: suites of specs, each spec's tests (one per project) with their outcome. */
export function playwrightFailures(report: JsonObject): FailedTest[] {
  const out: FailedTest[] = [];
  const walk = (suite: JsonObject, titles: string[]) => {
    for (const spec of list(suite.specs)) {
      for (const test of list(spec.tests)) {
        const name = `[${text(test.projectName)}] ${fromRoot(text(spec.file))} › ${[...titles, text(spec.title)].join(' › ')}`;
        if (test.status === 'unexpected') out.push({ kind: 'failed', name });
        else if (test.status === 'flaky') out.push({ kind: 'flaky', name });
      }
    }
    // A file's own suite is titled with its name, which the spec's file already gives.
    for (const child of list(suite.suites)) walk(child, child.file !== undefined && text(child.title) === text(child.file) ? titles : [...titles, text(child.title)]);
  };
  for (const suite of list(report.suites)) walk(suite, []);
  // Errors that belong to no test: a spec file that threw as it loaded, a test.only on CI, the web server that didn't
  // start, no tests found. The run failed though no test did.
  for (const error of list(report.errors)) {
    const where = isObject(error.location) ? fromRoot(text(error.location.file)) : '';
    out.push({ kind: 'failed', name: `${where ? `${where} ` : ''}(outside a test: ${firstLine(error.message) || 'an error'})` });
  }
  return out;
}

/** When the run started, as the report says: a report from an older or a narrower run reads as such. */
export function startedAt(report: JsonObject): string {
  const ms = typeof report.startTime === 'number' ? report.startTime : null;
  const stats = isObject(report.stats) ? text(report.stats.startTime) : '';
  const at = ms !== null ? new Date(ms) : stats ? new Date(stats) : null;
  return at && !Number.isNaN(at.getTime()) ? at.toLocaleString() : 'an unknown time';
}

/** Whichever report it is. */
export const failuresIn = (report: JsonObject): FailedTest[] => ('testResults' in report ? vitestFailures(report) : playwrightFailures(report));

function main(args: readonly string[]): number {
  const reports = args.length > 0 ? args : ['test-results/unit.json', 'test-results/e2e.json'].filter((path) => existsSync(path));
  if (reports.length === 0) {
    console.error('No test report found: run npm test or npm run e2e first.');
    return 1;
  }
  let unreadable = false;
  const found: FailedTest[] = [];
  for (const path of reports) {
    try {
      const report = JSON.parse(readFileSync(path, 'utf8')) as Json;
      if (!isObject(report)) throw new Error('not a test report');
      // Each run rewrites its report, a rerun of one file too: the time says which run this is.
      console.log(`${path}: the run started ${startedAt(report)}`);
      found.push(...failuresIn(report));
    } catch (error) {
      console.error(`Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      unreadable = true;
    }
  }
  if (found.length === 0) console.log(`No failed or flaky tests in ${reports.join(', ')}.`);
  for (const { kind, name } of found) console.log(`${kind === 'flaky' ? 'FLAKY ' : 'FAILED'} ${name}`);
  return unreadable ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
