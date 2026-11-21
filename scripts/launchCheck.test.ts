import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/launchCheck.sh judged with a stand-in for the app (6.27r): a small shell script that prints the lines it is
// told to and exits with the code it is told to, so the script's flag and its refusals are pinned without a built app.
// It needs bash and an executable file: it runs where CI runs the unit tests (Linux) and on a Mac. On Windows it is
// skipped by platform: there an executable bit means nothing to Node, and Git Bash is not where Vitest runs.

const root = join(import.meta.dirname, '..');
const work = join(root, 'test-results', 'launch-check-sh');
const usage = "usage: bash scripts/launchCheck.sh [--accents-by-page-ok] <path to the app's executable>";
const byPageNote =
  'by the page: read ok, 16 × 16, 3 accents; the worker: The object is in an invalid state. (worker: draw); ' +
  'the worker asked again: the same';

let made = 0;

/** A stand-in app that prints `lines` and exits with `code`; its path. */
function standIn(lines: string[], code: number): string {
  made += 1;
  const folder = join(work, String(made));
  mkdirSync(folder, { recursive: true });
  const app = join(folder, 'storiiboard');
  // A quoted heredoc: the lines come out exactly as written, parentheses and all.
  writeFileSync(app, `#!/bin/sh\ncat <<'END_OF_LINES'\n${lines.join('\n')}\nEND_OF_LINES\nexit ${String(code)}\n`);
  chmodSync(app, 0o755);
  return app;
}

/**
 * The script run with `args`, its log in the stand-in's own folder. The job summary is `summary` when given, else
 * none: in CI the real one is set, and these runs must never write into it.
 */
function launchCheck(args: string[], summary = ''): { code: number | null; out: string } {
  const result = spawnSync('bash', ['scripts/launchCheck.sh', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEMP: join(work, 'logs'), GITHUB_STEP_SUMMARY: summary },
    timeout: 60_000,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const noReadNote =
  "this machine can't read a canvas back (worker: read: The object is in an invalid state.; " +
  'page: read failed: The object is in an invalid state.)';
const before = [
  'launch check: window ok',
  'launch check: loaded ok',
  'launch check: page ok',
  'launch check: policy-watch ok',
  'launch check: pdf-text ok',
];
const after = ['launch check: worker-policy ok', 'launch check: no-violation ok', 'launch check: passed'];

/** An empty job summary of its own, as GitHub gives each step. */
function summaryFile(): string {
  made += 1;
  const folder = join(work, String(made));
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'summary.md');
  writeFileSync(file, '');
  return file;
}

const passed = [
  'launch check: window ok',
  'launch check: loaded ok',
  'launch check: accents ok',
  'launch check: passed',
];

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('scripts/launchCheck.sh with a stand-in app (skipped on Windows)', () => {
  it('passes a plain pass, with and without --accents-by-page-ok', () => {
    const app = standIn(passed, 0);
    for (const args of [[app], ['--accents-by-page-ok', app]]) {
      const { code, out } = launchCheck(args);
      expect(code, out).toBe(0);
      expect(out).not.toContain('FAILED');
      expect(out).not.toContain('warning: the accents came from the page');
    }
  });

  it('refuses a pass by the page without the flag, and passes it with the flag, repeating the note', () => {
    const app = standIn(
      ['launch check: window ok', `launch check: accents ok (${byPageNote})`, 'launch check: passed'],
      0,
    );
    const strict = launchCheck([app]);
    expect(strict.code, strict.out).toBe(1);
    expect(strict.out).toContain('launch check: FAILED: the accents came from the page, not the worker');

    const allowed = launchCheck(['--accents-by-page-ok', app]);
    expect(allowed.code, allowed.out).toBe(0);
    const warning = 'launch check: warning: the accents came from the page, not the worker, as --accents-by-page-ok allows';
    expect(allowed.out).toContain(`${warning}: ${byPageNote}\n`);
    expect(allowed.out).not.toContain('FAILED');
  });

  it('writes the by-the-page warning into the job summary too, when it is set', () => {
    const app = standIn(
      ['launch check: window ok', `launch check: accents ok (${byPageNote})`, 'launch check: passed'],
      0,
    );
    const summary = summaryFile();
    const allowed = launchCheck(['--accents-by-page-ok', app], summary);
    expect(allowed.code, allowed.out).toBe(0);
    const warning =
      'launch check: warning: the accents came from the page, not the worker, as --accents-by-page-ok allows: ' +
      byPageNote;
    expect(allowed.out).toContain(`${warning}\n`);
    expect(readFileSync(summary, 'utf8')).toBe(`${warning}\n`);
  });

  it('refuses "this machine can’t read a canvas back" without the flag, and passes it with a warning', () => {
    const app = standIn([...before, `launch check: accents ok (${noReadNote})`, ...after], 0);
    const summary = summaryFile();
    const strict = launchCheck([app], summary);
    expect(strict.code, strict.out).toBe(1);
    expect(strict.out).toContain('launch check: FAILED: neither the worker nor the page could read a canvas back');
    expect(strict.out).toContain(`launch check: accents ok (${noReadNote})\n`);
    expect(readFileSync(summary, 'utf8')).toBe('');

    const allowed = launchCheck(['--accents-by-page-ok', app], summary);
    expect(allowed.code, allowed.out).toBe(0);
    const warning =
      'launch check: warning: neither the worker nor the page could read a canvas back, as --accents-by-page-ok ' +
      `allows: ${noReadNote}`;
    expect(allowed.out).toContain(`${warning}\n`);
    // The app's own line stays in the log.
    expect(allowed.out).toContain(`launch check: accents ok (${noReadNote})\n`);
    expect(allowed.out).not.toContain('FAILED');
    expect(readFileSync(summary, 'utf8')).toBe(`${warning}\n`);
  });

  it('fails a silent worker and a decode failure with the flag too', () => {
    for (const why of [
      'the accent worker failed or took over 15 s; on the page: read failed: The object is in an invalid state.',
      'The object is in an invalid state. (worker: decode); on the page: read failed: The object is in an invalid state.',
    ]) {
      const app = standIn([...before, `launch check: FAILED at accents: ${why}`], 16);
      const summary = summaryFile();
      const { code, out } = launchCheck(['--accents-by-page-ok', app], summary);
      expect(code, out).toBe(1);
      expect(out).toContain('launch check: exit code 16: step 6 (accents) failed');
      expect(out).not.toContain('warning:');
      expect(readFileSync(summary, 'utf8')).toBe('');
    }
  });

  it('fails with the usage line on an unknown flag, no path, or two paths', () => {
    const app = standIn(passed, 0);
    for (const args of [['--no-such-flag', app], [], ['--accents-by-page-ok'], [app, app]]) {
      const { code, out } = launchCheck(args);
      expect(code, out).toBe(1);
      expect(out).toContain(usage);
    }
  });

  it('fails when the app fails at accents, and the flag changes nothing', () => {
    const app = standIn(
      [
        'launch check: window ok',
        'launch check: FAILED at accents: The object is in an invalid state. (worker: draw); on the page: failed: x',
      ],
      16,
    );
    for (const args of [[app], ['--accents-by-page-ok', app]]) {
      const { code, out } = launchCheck(args);
      expect(code, out).toBe(1);
      expect(out).toContain('launch check: exit code 16: step 6 (accents) failed');
      expect(out).not.toContain('warning: the accents came from the page');
    }
  });
});
