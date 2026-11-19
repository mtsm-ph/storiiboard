import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cargoTreeCrates,
  classify,
  compareVersions,
  findingLine,
  lockPackages,
  markdown,
  mergeAdvisories,
  npmAuditAdvisories,
  osvAdvisories,
  parseIgnores,
  rangeCovers,
  summaryLine,
  unusedIgnores,
  type Context,
  type Finding,
} from './advisories';

// The Advisories job (Kevin, Nov 18) on made-up OSV-Scanner and npm audit reports and cargo tree text, in the shapes
// those tools write: red only for what ships and for malware anywhere, everything else listed.

const root = join(import.meta.dirname, '..');

const lock = lockPackages({
  name: 'storiiboard',
  lockfileVersion: 3,
  packages: {
    '': { name: 'storiiboard', version: '0.1.0' },
    'node_modules/pdfjs-dist': { version: '5.7.284' },
    'node_modules/minimatch': { version: '9.0.5', dev: true },
    'node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch': { version: '9.0.3', dev: true },
    'node_modules/typescript-eslint': { version: '8.72.1', dev: true },
    'node_modules/left-padder': { version: '1.0.0', dev: true },
    'node_modules/zustand': { version: '5.0.15' },
    'node_modules/pdf-maker': { version: '2.0.0' },
    'node_modules/test-runner/node_modules/pdf-maker': { version: '1.0.0', dev: true },
  },
});

const windowsTree = cargoTreeCrates(
  [
    'storiiboard v0.1.0 (C:\\Users\\robin\\storiiboard\\src-tauri)',
    '├── rusqlite v0.41.1',
    '│   └── libsqlite3-sys v0.39.0',
    '├── tauri v2.12.5',
    '│   ├── windows v0.61.3',
    '│   └── serde v1.0.228',
    '└── fxhash v0.2.1 (*)',
  ].join('\n'),
);
const macTree = cargoTreeCrates(['storiiboard v0.1.0 (/Users/robin/storiiboard/src-tauri)', 'rusqlite v0.41.1', 'libsqlite3-sys v0.39.0', 'objc2 v0.6.3', 'fxhash v0.2.1 (*)'].join('\n'));

const PDFJS_REASON =
  "The flaw needs PDF scripting switched on and no script policy. readPdf.ts only reads text, builds no annotation layer and loads nothing from pdfjs-dist/web, and the app's policy allows no inline script and no eval.";

const ignores = parseIgnores(`[[IgnoredVulns]]\nid = "GHSA-hq66-cqwq-w95j"\nignoreUntil = 2027-02-01\nreason = "${PDFJS_REASON.replace(/"/g, '\\"')}"\n`);

const context = (overrides: Partial<Context> = {}): Context => ({
  lock,
  trees: [
    { target: 'Windows', crates: windowsTree },
    { target: 'the Mac', crates: macTree },
  ],
  ignores,
  now: Date.parse('2026-11-19T12:00:00Z'),
  ...overrides,
});

interface VulnSketch {
  id: string;
  aliases?: string[];
  summary?: string;
  fixed?: string;
  informational?: string;
}

const osvPackage = (ecosystem: string, name: string, version: string, vulns: VulnSketch[]) => ({
  package: { name, version, ecosystem },
  vulnerabilities: vulns.map((vuln) => ({
    id: vuln.id,
    aliases: vuln.aliases ?? [],
    summary: vuln.summary ?? '',
    affected: [
      {
        package: { ecosystem, name },
        ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, ...(vuln.fixed ? [{ fixed: vuln.fixed }] : [])] }],
        ...(vuln.informational ? { database_specific: { informational: vuln.informational } } : {}),
      },
    ],
  })),
  groups: vulns.map((vuln) => ({ ids: [vuln.id], aliases: vuln.aliases ?? [] })),
});

const osvReport = (npm: ReturnType<typeof osvPackage>[], crates: ReturnType<typeof osvPackage>[]) => ({
  results: [
    { source: { path: '/home/runner/work/storiiboard/storiiboard/package-lock.json', type: 'lockfile' }, packages: npm },
    { source: { path: '/home/runner/work/storiiboard/storiiboard/src-tauri/Cargo.lock', type: 'lockfile' }, packages: crates },
  ],
});

const npmEntry = (name: string, nodes: string[], ghsa: string, title: string, fixAvailable: unknown = true) => ({
  name,
  severity: 'high',
  isDirect: false,
  via: [{ source: 1100001, name, dependency: name, title, url: `https://github.com/advisories/${ghsa}`, severity: 'high', range: '<99.0.0' }],
  effects: [],
  range: '<99.0.0',
  nodes,
  fixAvailable,
});

/** What the first run found on v2 (Nov 18), with rusqlite 0.41.1 merged: libsqlite3-sys's advisory is gone. */
const v2Osv = osvReport(
  [
    osvPackage('npm', 'pdfjs-dist', '5.7.284', [{ id: 'GHSA-hq66-cqwq-w95j', summary: 'Arbitrary script run through PDF scripting', fixed: '5.8.0' }]),
    osvPackage('npm', 'minimatch', '9.0.5', [{ id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2026-1111'], summary: 'ReDoS in a pattern', fixed: '9.0.6' }]),
    osvPackage('npm', 'typescript-eslint', '8.72.1', [{ id: 'GHSA-dddd-eeee-ffff', summary: 'Something in a linter' }]),
  ],
  [
    osvPackage('crates.io', 'glib', '0.18.5', [{ id: 'RUSTSEC-2024-0429', aliases: ['GHSA-wrw7-89jp-8q8g'], summary: 'Unsoundness in Iterator impls', fixed: '0.20.0' }]),
    ...['fxhash', 'instant', 'paste', 'proc-macro-error', 'atk'].map((name) =>
      osvPackage('crates.io', name, name === 'fxhash' ? '0.2.1' : '1.0.0', [{ id: `RUSTSEC-2025-00${String(name.length)}`, summary: `${name} is unmaintained`, informational: 'unmaintained' }]),
    ),
  ],
);
const v2Npm = {
  auditReportVersion: 2,
  vulnerabilities: {
    'pdfjs-dist': npmEntry('pdfjs-dist', ['node_modules/pdfjs-dist'], 'GHSA-hq66-cqwq-w95j', 'Arbitrary script run through PDF scripting', {
      name: 'pdfjs-dist',
      version: '5.8.0',
      isSemVerMajor: false,
    }),
    minimatch: npmEntry('minimatch', ['node_modules/minimatch'], 'GHSA-aaaa-bbbb-cccc', 'ReDoS in a pattern'),
    // Listed only for pulling minimatch in: its advisory is minimatch's, not its own.
    '@typescript-eslint/typescript-estree': { name: '@typescript-eslint/typescript-estree', via: ['minimatch'], nodes: [], fixAvailable: true },
  },
  metadata: { vulnerabilities: { high: 2 } },
};

const findingsOf = (osv: unknown, npm: unknown, overrides: Partial<Context> = {}): Finding[] => {
  const ctx = context(overrides);
  return classify(mergeAdvisories([...osvAdvisories(osv as never), ...npmAuditAdvisories(npm as never, ctx.lock)]), ctx);
};
const byName = (findings: Finding[], name: string): Finding => {
  const found = findings.find((finding) => finding.name === name);
  if (!found) throw new Error(`no finding for ${name}`);
  return found;
};

describe('the Advisories job', () => {
  it('is green on v2 with rusqlite 0.41.1 and the pdfjs ignore, and lists every finding', () => {
    const findings = findingsOf(v2Osv, v2Npm);
    expect(findings.filter((finding) => finding.red)).toEqual([]);
    expect(findings.map((finding) => [finding.name, finding.verdict]).sort()).toEqual(
      [
        ['atk', 'unmaintained'],
        ['fxhash', 'unmaintained'],
        ['glib', 'linux-or-build'],
        ['instant', 'unmaintained'],
        ['minimatch', 'dev-only'],
        ['paste', 'unmaintained'],
        ['pdfjs-dist', 'ignored'],
        ['proc-macro-error', 'unmaintained'],
        ['typescript-eslint', 'dev-only'],
      ].sort(),
    );
    // OSV's and npm audit's copies of one flaw are one finding, from both.
    const pdfjs = byName(findings, 'pdfjs-dist');
    expect(pdfjs.sources).toEqual(['OSV', 'npm audit']);
    expect(pdfjs.ignore?.reason).toBe(PDFJS_REASON);
    expect(findingLine(pdfjs)).toContain('ignored until 2027-02-01');
    expect(findingLine(pdfjs)).toContain(`reason: ${PDFJS_REASON}`);
    expect(summaryLine(findings)).toBe('9 findings, 0 red (0 shipped, 0 malware); 1 ignored, 2 dev only, 1 Linux or build only, 5 unmaintained.');
    const table = markdown(findings);
    for (const finding of findings) expect(table).toContain(`${finding.ecosystem} ${finding.name} ${finding.version}`);
  });

  it('is red for an advisory on a crate in the Windows or the Mac tree: libsqlite3-sys 0.38.2 before rusqlite 0.41.1', () => {
    const before = cargoTreeCrates('storiiboard v0.1.0 (/x)\n└── rusqlite v0.37.0\n    └── libsqlite3-sys v0.38.2\n');
    const osv = osvReport([], [osvPackage('crates.io', 'libsqlite3-sys', '0.38.2', [{ id: 'RUSTSEC-2026-0459', summary: 'A flaw in the bundled SQLite', fixed: '0.39.0' }])]);
    const [finding] = findingsOf(osv, { auditReportVersion: 2, vulnerabilities: {} }, { trees: [{ target: 'Windows', crates: before }, { target: 'the Mac', crates: macTree }] });
    expect(finding).toMatchObject({ verdict: 'ships', red: true, targets: ['Windows'] });
    expect(findingLine(finding as Finding)).toMatch(/^RED {2}ships \(Windows\)/);
    expect(findingLine(finding as Finding)).toContain('fixed in 0.39.0');
  });

  it('is red for an advisory on an npm package that ships, and not for one only dev tools install', () => {
    const osv = osvReport(
      [
        osvPackage('npm', 'zustand', '5.0.15', [{ id: 'GHSA-zzzz-zzzz-zzzz', summary: 'A made-up flaw', fixed: '5.0.16' }]),
        osvPackage('npm', 'minimatch', '9.0.3', [{ id: 'GHSA-mmmm-mmmm-mmmm', summary: 'A made-up dev flaw' }]),
      ],
      [],
    );
    const findings = findingsOf(osv, { auditReportVersion: 2, vulnerabilities: {} });
    expect(byName(findings, 'zustand')).toMatchObject({ verdict: 'ships', red: true });
    // Found by name and version in the lock file, a nested install included.
    expect(byName(findings, 'minimatch')).toMatchObject({ verdict: 'dev-only', red: false });
  });

  it('applies an ignore only before its date, by an alias too', () => {
    const osv = osvReport([osvPackage('npm', 'pdfjs-dist', '5.7.284', [{ id: 'CVE-2026-9999', aliases: ['GHSA-hq66-cqwq-w95j'], summary: 'Script' }])], []);
    const npm = { auditReportVersion: 2, vulnerabilities: {} };
    const before = findingsOf(osv, npm, { now: Date.parse('2027-01-31T23:59:59Z') });
    expect(before[0]).toMatchObject({ verdict: 'ignored', red: false });
    const after = findingsOf(osv, npm, { now: Date.parse('2027-02-01T00:00:00Z') });
    expect(after[0]).toMatchObject({ verdict: 'ships', red: true });
    expect(after[0]?.ignore).toBeUndefined();
    expect(findingLine(after[0] as Finding)).toContain('its ignore ended 2027-02-01');
  });

  it('is red for malware anywhere: in a dev package, and in a crate on Linux only', () => {
    const osv = osvReport(
      [osvPackage('npm', 'left-padder', '1.0.0', [{ id: 'MAL-2026-1234', summary: 'Malicious code in left-padder (npm)' }])],
      [osvPackage('crates.io', 'gtk-helper', '0.1.0', [{ id: 'RUSTSEC-2026-0001', aliases: ['MAL-2026-5678'], summary: 'Steals keys' }])],
    );
    const npm = {
      auditReportVersion: 2,
      vulnerabilities: { 'left-padder': npmEntry('left-padder', ['node_modules/left-padder'], 'GHSA-mmmm-aaaa-llll', 'Malware in left-padder', false) },
    };
    const findings = findingsOf(osv, npm);
    expect(findings.map((finding) => [finding.name, finding.verdict, finding.red])).toEqual([
      ['left-padder', 'malware', true],
      ['gtk-helper', 'malware', true],
      // npm audit's copy has a GHSA id OSV didn't name, so it stands on its own, and its title says malware.
      ['left-padder', 'malware', true],
    ]);
    expect(summaryLine(findings)).toBe('3 findings, 3 red (0 shipped, 3 malware); 0 ignored, 0 dev only, 0 Linux or build only, 0 unmaintained.');
  });

  it('is not red for a crate only on Linux, nor for an unmaintained notice on a crate that ships', () => {
    const osv = osvReport(
      [],
      [
        osvPackage('crates.io', 'webkit2gtk', '2.0.1', [{ id: 'RUSTSEC-2026-0100', summary: 'A Linux flaw' }]),
        osvPackage('crates.io', 'fxhash', '0.2.1', [{ id: 'RUSTSEC-2025-0057', summary: 'fxhash is no longer maintained', informational: 'unmaintained' }]),
      ],
    );
    const findings = findingsOf(osv, { auditReportVersion: 2, vulnerabilities: {} });
    expect(byName(findings, 'webkit2gtk')).toMatchObject({ verdict: 'linux-or-build', red: false, targets: [] });
    expect(byName(findings, 'fxhash')).toMatchObject({ verdict: 'unmaintained', red: false, targets: ['Windows', 'the Mac'] });
  });

  it('still shows a finding with no fix listed', () => {
    const osv = osvReport([], [osvPackage('crates.io', 'serde', '1.0.228', [{ id: 'RUSTSEC-2026-0200', summary: 'No fix yet' }])]);
    const npm = {
      auditReportVersion: 2,
      vulnerabilities: { zustand: npmEntry('zustand', ['node_modules/zustand'], 'GHSA-nnnn-oooo-pppp', 'No fix either', false) },
    };
    const findings = findingsOf(osv, npm);
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.red).toBe(true);
      expect(findingLine(finding)).toContain('no fix listed');
      expect(markdown(findings)).toContain(finding.ids[0]);
    }
  });

  it('takes only GitHub’s malware title as malware: a flaw that mentions malicious code stays what it is', () => {
    const npm = {
      auditReportVersion: 2,
      vulnerabilities: {
        'typescript-eslint': npmEntry(
          'typescript-eslint',
          ['node_modules/typescript-eslint'],
          'GHSA-qqqq-rrrr-ssss',
          'Arbitrary code execution when compiling specifically crafted malicious code',
        ),
      },
    };
    const [finding] = findingsOf(osvReport([], []), npm);
    expect(finding).toMatchObject({ verdict: 'dev-only', red: false, malware: false });
  });

  it('counts an npm audit advisory only on the installed versions its range covers', () => {
    const npm = {
      auditReportVersion: 2,
      vulnerabilities: {
        'pdf-maker': {
          name: 'pdf-maker',
          severity: 'high',
          isDirect: true,
          via: [
            { source: 1, name: 'pdf-maker', title: 'A: an old flaw', url: 'https://github.com/advisories/GHSA-aaaa-1111-aaaa', range: '<1.5.0' },
            { source: 2, name: 'pdf-maker', title: 'B: a new flaw', url: 'https://github.com/advisories/GHSA-bbbb-2222-bbbb', range: '>=2.0.0 <2.0.3' },
          ],
          effects: [],
          range: '*',
          nodes: ['node_modules/pdf-maker', 'node_modules/test-runner/node_modules/pdf-maker'],
          fixAvailable: true,
        },
      },
    };
    const b = { id: 'GHSA-bbbb-2222-bbbb', until: '2027-02-01', untilMs: Date.parse('2027-02-01T00:00:00Z'), reason: 'made up' };
    const findings = findingsOf(osvReport([], []), npm, { ignores: [b] });
    expect(findings.map((finding) => [finding.ids[0], finding.version, finding.verdict])).toEqual([
      ['GHSA-aaaa-1111-aaaa', '1.0.0', 'dev-only'],
      ['GHSA-bbbb-2222-bbbb', '2.0.0', 'ignored'],
    ]);
    expect(findings.some((finding) => finding.red)).toBe(false);
  });

  it('counts an advisory whose range it can’t read on every version, and says so', () => {
    const npm = {
      auditReportVersion: 2,
      vulnerabilities: {
        zustand: { ...npmEntry('zustand', ['node_modules/zustand'], 'GHSA-uuuu-vvvv-wwww', 'Odd range'), via: [{ source: 3, title: 'Odd range', url: 'https://github.com/advisories/GHSA-uuuu-vvvv-wwww', range: '^5.0' }] },
      },
    };
    const [finding] = findingsOf(osvReport([], []), npm);
    expect(finding).toMatchObject({ verdict: 'ships', red: true });
    expect(findingLine(finding as Finding)).toContain('npm audit\'s range "^5.0" couldn\'t be read against 5.0.15, so it counts');
  });

  it('silences malware only by an ignore of its own MAL- id, never through an alias or OSV’s group', () => {
    const osv = osvReport(
      [
        {
          ...osvPackage('npm', 'left-padder', '1.0.0', [{ id: 'MAL-2026-0042', aliases: ['GHSA-gggg-hhhh-iiii'], summary: 'Malicious code in left-padder (npm)' }]),
          groups: [{ ids: ['MAL-2026-0042', 'GHSA-jjjj-kkkk-llll'], aliases: [] }],
        },
      ],
      [],
    );
    const until = { until: '2027-02-01', untilMs: Date.parse('2027-02-01T00:00:00Z'), reason: 'made up' };
    for (const id of ['GHSA-gggg-hhhh-iiii', 'GHSA-jjjj-kkkk-llll']) {
      const [finding] = findingsOf(osv, { auditReportVersion: 2, vulnerabilities: {} }, { ignores: [{ id, ...until }] });
      expect(finding, id).toMatchObject({ verdict: 'malware', red: true });
      expect(findingLine(finding as Finding)).toContain(`the ignore of ${id} doesn't silence malware`);
    }
    const [own] = findingsOf(osv, { auditReportVersion: 2, vulnerabilities: {} }, { ignores: [{ id: 'MAL-2026-0042', ...until }] });
    expect(own).toMatchObject({ verdict: 'ignored', red: false });
  });

  it('names an ignore that matched nothing', () => {
    expect(unusedIgnores([], ignores).map(({ id }) => id)).toEqual(['GHSA-hq66-cqwq-w95j']);
  });

  it('refuses a report that isn’t one, and npm audit’s own failure', () => {
    expect(() => osvAdvisories({})).toThrow(/OSV-Scanner/);
    expect(() => npmAuditAdvisories({ error: { code: 'ENOAUDIT', summary: 'audit endpoint returned an error' } }, lock)).toThrow(/npm audit failed/);
    expect(() => npmAuditAdvisories({}, lock)).toThrow(/npm audit/);
    expect(() => cargoTreeCrates('error: could not find `Cargo.toml`')).toThrow(/cargo tree/);
    expect(() => lockPackages({ dependencies: {} })).toThrow(/package-lock/);
  });

  // The job's runs leave proc macros out (-e normal,no-proc-macro); the reader still copes with one's mark.
  it('reads cargo tree with or without its prefix, a duplicate’s (*) and a proc macro’s mark left out', () => {
    expect([...cargoTreeCrates('0storiiboard v0.1.0 (/x)\n1serde_derive v1.0.228 (proc-macro)\n1serde v1.0.228 (*)\n')]).toEqual([
      'storiiboard@0.1.0',
      'serde_derive@1.0.228',
      'serde@1.0.228',
    ]);
    expect(windowsTree.has('fxhash@0.2.1')).toBe(true);
    expect(windowsTree.has('libsqlite3-sys@0.39.0')).toBe(true);
  });
});

describe('npm’s version ranges', () => {
  it('reads each comparator, AND within a part and OR across ||', () => {
    expect(rangeCovers('<1.5.0', '1.4.9')).toBe(true);
    expect(rangeCovers('<1.5.0', '1.5.0')).toBe(false);
    expect(rangeCovers('<=1.5.0', '1.5.0')).toBe(true);
    expect(rangeCovers('>1.5.0', '1.5.0')).toBe(false);
    expect(rangeCovers('>= 2.0.0 < 2.3.1', '2.3.0')).toBe(true);
    expect(rangeCovers('>=2.0.0 <2.3.1', '2.3.1')).toBe(false);
    expect(rangeCovers('=1.2.3', '1.2.3')).toBe(true);
    expect(rangeCovers('1.2.3', '1.2.4')).toBe(false);
    expect(rangeCovers('<1.0.0 || >=2.0.0', '1.5.0')).toBe(false);
    expect(rangeCovers('<1.0.0 || >=2.0.0', '2.0.0')).toBe(true);
    expect(rangeCovers('*', '0.0.1')).toBe(true);
  });

  it('puts a pre-release below its release, its identifiers compared as semver does', () => {
    expect(rangeCovers('<2.0.0', '2.0.0-rc.1')).toBe(true);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0);
  });

  it('says it can’t read a range or a version, anywhere in it', () => {
    for (const range of ['^1.2.0', '1.x', '1.0.0 - 2.0.0', '~1.2', '', '<1.0.0 || ^2.0.0', '>=0.0.0 <2']) expect(rangeCovers(range, '1.5.0'), range).toBeNull();
    expect(rangeCovers('<2.0.0', 'unknown version')).toBeNull();
  });
});

describe('osv-scanner.toml', () => {
  it('holds Kevin’s one ignore (Nov 18), in his words, until 2027-02-01', () => {
    const fromFile = parseIgnores(readFileSync(join(root, 'osv-scanner.toml'), 'utf8'));
    expect(fromFile).toEqual([{ id: 'GHSA-hq66-cqwq-w95j', until: '2027-02-01', untilMs: Date.parse('2027-02-01T00:00:00Z'), reason: PDFJS_REASON }]);
  });

  it('refuses what it can’t read, and an ignore without its reason or its date', () => {
    expect(() => parseIgnores('[[PackageOverrides]]\nname = "x"\n')).toThrow(/PackageOverrides/);
    expect(() => parseIgnores('[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2027-02-01\n')).toThrow(/reason/);
    expect(() => parseIgnores('[[IgnoredVulns]]\nid = "GHSA-x"\nreason = "why"\n')).toThrow(/ignoreUntil/);
    expect(() => parseIgnores('[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = "soon"\nreason = "why"\n')).toThrow(/ignoreUntil/);
    expect(() => parseIgnores('[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2027-02-01\nreason = "why"\neffort = 3\n')).toThrow(/effort/);
    expect(() => parseIgnores('id = "GHSA-x"\n')).toThrow(/outside/);
  });

  it('reads comments, literal strings, escapes and a date-time with its zone', () => {
    const [ignore] = parseIgnores(
      "# a comment\n[[IgnoredVulns]] # and another\nid = 'GHSA-#-x' # after a value\nignoreUntil = 2027-02-01T12:00:00+02:00\nreason = \"says \\\"no\\\" # not a comment\"\n",
    );
    expect(ignore).toEqual({ id: 'GHSA-#-x', until: '2027-02-01T12:00:00+02:00', untilMs: Date.parse('2027-02-01T10:00:00Z'), reason: 'says "no" # not a comment' });
  });
});
