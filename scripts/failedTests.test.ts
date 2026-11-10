import { describe, expect, it } from 'vitest';
import { failuresIn, playwrightFailures, startedAt, vitestFailures } from './failedTests';

// Every failed test by name (3.19): read from Vitest's and Playwright's JSON reports, in the shapes they write.

describe('the failed tests in a run', () => {
  it('reads Vitest’s report: each failed test by file and title, and a file that didn’t load', () => {
    const report = {
      numFailedTests: 1,
      testResults: [
        {
          name: 'C:\\Users\\kevma\\Documents\\storiiboard\\src\\core\\model\\sceneApprovals.test.ts',
          status: 'failed',
          assertionResults: [
            { ancestorTitles: ['a scene’s approvals'], title: 'keeps each sign-off', status: 'passed' },
            { ancestorTitles: ['what a department touches', 'by rule'], title: 'reads 3:', status: 'failed' },
          ],
        },
        { name: '/home/runner/work/storiiboard/storiiboard/src/app/broken.test.ts', status: 'failed', assertionResults: [] },
        { name: '/home/runner/work/storiiboard/storiiboard/scripts/fine.test.ts', status: 'passed', assertionResults: [{ title: 'ok', status: 'passed' }] },
      ],
    };
    expect(vitestFailures(report)).toEqual([
      { kind: 'failed', name: 'src/core/model/sceneApprovals.test.ts › what a department touches › by rule › reads 3:' },
      { kind: 'failed', name: "src/app/broken.test.ts (didn't load)" },
    ]);
    expect(failuresIn(report)).toHaveLength(2);
  });

  it('reads Playwright’s report: failed and flaky per project, under their describe blocks, never the passed or skipped', () => {
    const report = {
      config: {},
      suites: [
        {
          title: 'player.spec.ts',
          file: 'player.spec.ts',
          specs: [
            {
              title: 'grabs a still',
              file: 'player.spec.ts',
              tests: [
                { projectName: 'chromium', status: 'flaky' },
                { projectName: 'webkit', status: 'unexpected' },
              ],
            },
          ],
          suites: [
            {
              title: '2.7 the player',
              file: 'player.spec.ts',
              specs: [
                { title: 'steps a frame', file: 'player.spec.ts', tests: [{ projectName: 'chromium', status: 'unexpected' }] },
                { title: 'plays', file: 'player.spec.ts', tests: [{ projectName: 'chromium', status: 'expected' }, { projectName: 'webkit', status: 'skipped' }] },
              ],
            },
          ],
        },
      ],
    };
    expect(playwrightFailures(report)).toEqual([
      { kind: 'flaky', name: '[chromium] player.spec.ts › grabs a still' },
      { kind: 'failed', name: '[webkit] player.spec.ts › grabs a still' },
      { kind: 'failed', name: '[chromium] player.spec.ts › 2.7 the player › steps a frame' },
    ]);
    expect(failuresIn(report)).toHaveLength(3);
  });

  it('names a file that failed with no test failed: a hook that threw, before or after its tests', () => {
    const file = (status: string, message: string) => ({
      name: '/repo/src/app/hooks.test.ts',
      status: 'failed',
      message,
      assertionResults: [{ ancestorTitles: [], title: 'one', status }],
    });
    expect(vitestFailures({ testResults: [file('skipped', 'Error: beforeAll broke\n    at …')] })).toEqual([
      { kind: 'failed', name: 'src/app/hooks.test.ts (failed outside a test: Error: beforeAll broke)' },
    ]);
    expect(vitestFailures({ testResults: [file('passed', 'afterAll broke')] })).toEqual([
      { kind: 'failed', name: 'src/app/hooks.test.ts (failed outside a test: afterAll broke)' },
    ]);
    // One failed test already names the file: no second line for it.
    expect(vitestFailures({ testResults: [file('failed', 'x')] })).toHaveLength(1);
  });

  it('names Playwright’s errors outside every test: a spec that threw as it loaded, a server that didn’t start', () => {
    const report = {
      suites: [],
      errors: [
        { message: 'Error: probe\n    at zz-probe.spec.ts:2', location: { file: 'C:\\repo\\e2e\\zz-probe.spec.ts', line: 2, column: 7 } },
        { message: 'Timed out waiting 120000ms from config.webServer.' },
      ],
    };
    expect(playwrightFailures(report)).toEqual([
      { kind: 'failed', name: 'e2e/zz-probe.spec.ts (outside a test: Error: probe)' },
      { kind: 'failed', name: '(outside a test: Timed out waiting 120000ms from config.webServer.)' },
    ]);
  });

  it('says when each run started, so a narrower or older run’s report reads as one', () => {
    expect(startedAt({ startTime: Date.UTC(2026, 10, 9, 22, 0) })).toBe(new Date(Date.UTC(2026, 10, 9, 22, 0)).toLocaleString());
    expect(startedAt({ stats: { startTime: '2026-11-09T22:00:00.000Z' } })).toBe(new Date('2026-11-09T22:00:00.000Z').toLocaleString());
    expect(startedAt({})).toBe('an unknown time');
  });

  it('finds none in a clean run', () => {
    expect(failuresIn({ testResults: [] })).toEqual([]);
    expect(failuresIn({ suites: [] })).toEqual([]);
  });
});
