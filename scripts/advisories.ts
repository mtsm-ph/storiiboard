// The Advisories job (Kevin, Nov 18): red for a known vulnerability or malware in what Storiiboard ships, and only for
// that. It reads what the job gathered: OSV-Scanner's JSON on package-lock.json and src-tauri/Cargo.lock, `npm audit
// --json`, and `cargo tree -e normal,no-proc-macro --target <triple>` for the Windows app and the Mac app; and from the
// repo, package-lock.json and osv-scanner.toml. Every finding is one line, then a summary; it exits 1 only when one is
// red.
//
//   node scripts/advisories.ts --osv osv.json --npm npm-audit.json --tree-windows tree-windows.txt --tree-mac tree-mac.txt
//                              [--lock package-lock.json] [--config osv-scanner.toml]
//
// Red: an advisory on an npm package that isn't dev only, or on a crate in the app's normal tree for Windows
// (x86_64-pc-windows-msvc) or the Mac (aarch64-apple-darwin); and malware anywhere, dev tools included, since it runs
// on our own machines. Listed, never red: dev-only npm packages, crates only on Linux or only at build time (in
// Cargo.lock but in neither tree: build scripts' crates and proc macros, which run as the app is compiled and aren't in
// what ships), RUSTSEC's "unmaintained" notices, and what osv-scanner.toml ignores until its date. npm audit's advisory
// counts only on the installed versions its range covers; a range this can't read covers every version, and says so.
// An ignore is matched by the advisory's id or any of its aliases, for both sources. Malware is silenced only by an
// ignore of its own MAL- id, never through an alias or OSV's group: an ignore given for a flaw must never let
// malware through. Past its date an ignore no longer applies.
//
// The job runs OSV-Scanner with an empty config, so it reports everything and the ignores are applied here once, the
// same way for npm audit's findings; osv-scanner.toml still works when OSV-Scanner is run by hand from the repo.
// A missing or unreadable input exits 1, so a step that broke is never mistaken for a clean run. Plain TypeScript Node
// runs as is (type stripping, Node 22.18 and later): no enums.

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: Json | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: Json | undefined): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);
const strings = (value: Json | undefined): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const text = (value: Json | undefined): string => (typeof value === 'string' ? value : '');
const firstLine = (value: string): string => value.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';

export interface Ignore {
  id: string;
  /** As written in osv-scanner.toml. */
  until: string;
  /** The moment it stops applying: a bare date is that day's start, UTC. */
  untilMs: number;
  reason: string;
}

export interface Advisory {
  /** 'npm' or 'crates.io', as OSV names them. */
  ecosystem: string;
  name: string;
  version: string;
  /** The advisory's id first, then its aliases. */
  ids: string[];
  summary: string;
  /** Fixed versions, or what npm audit offers; empty when no fix is listed. */
  fixes: string[];
  sources: string[];
  malware: boolean;
  /** The malware advisories' own ids (MAL-…), never an alias: the only ids an ignore can silence malware by. */
  malwareIds: string[];
  unmaintained: boolean;
  /** npm audit's install paths in package-lock.json, when it named them. */
  nodes: string[];
  /** What the line should say besides: a range that couldn't be read, say. */
  notes: string[];
}

export type Verdict = 'ships' | 'malware' | 'dev-only' | 'linux-or-build' | 'unmaintained' | 'ignored';

export interface Finding extends Advisory {
  verdict: Verdict;
  red: boolean;
  /** Where a shipped crate is: 'Windows', 'the Mac'. */
  targets: string[];
  /** The ignore that let it through. */
  ignore?: Ignore;
  /** An ignore that matched but whose date has passed. */
  ignoreEnded?: Ignore;
}

// ---- osv-scanner.toml -----------------------------------------------------------------------------------------------

/** A line without its comment: a # outside a string. */
function withoutComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote === '"' && char === '\\') i += 1;
    else if (quote !== '' && char === quote) quote = '';
    else if (quote === '' && (char === '"' || char === "'")) quote = char;
    else if (quote === '' && char === '#') return line.slice(0, i);
  }
  return line;
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/** A TOML string on one line: "basic" with its escapes, or 'literal'. Null when the value isn't one. */
function tomlString(value: string): string | null {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'") && !value.slice(1, -1).includes("'")) return value.slice(1, -1);
  if (!value.startsWith('"') || value.startsWith('"""')) return null;
  let out = '';
  for (let i = 1; i < value.length; i += 1) {
    const char = value[i] ?? '';
    if (char === '"') return i === value.length - 1 ? out : null;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = value[i + 1] ?? '';
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(value.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(value.slice(i + 2, i + 6), 16));
      i += 5;
    } else if (next in ESCAPES) {
      out += ESCAPES[next] ?? '';
      i += 1;
    } else return null;
  }
  return null;
}

const TOML_DATE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?)?$/i;

/** A TOML date or date-time as a moment; one without a zone is read as UTC. Null when it isn't one. */
function tomlMoment(value: string): number | null {
  const match = TOML_DATE.exec(value);
  if (!match) return null;
  const [, day = '', time = '00:00:00', zone = 'Z'] = match;
  const ms = Date.parse(`${day}T${time}${zone}`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The ignores in osv-scanner.toml: OSV's own `[[IgnoredVulns]]` tables, each with `id`, `ignoreUntil` and `reason`.
 * Only that subset of TOML is read, and anything else throws: a table or key this doesn't know would otherwise be
 * skipped without a word, and every ignore must have its reason and its date.
 */
export function parseIgnores(toml: string): Ignore[] {
  const tables: { line: number; values: Map<string, string> }[] = [];
  toml.split(/\r?\n/).forEach((raw, index) => {
    const line = withoutComment(raw).trim();
    const at = `osv-scanner.toml, line ${String(index + 1)}`;
    if (line === '') return;
    if (line === '[[IgnoredVulns]]') {
      tables.push({ line: index + 1, values: new Map() });
      return;
    }
    if (line.startsWith('[')) throw new Error(`${at}: ${line} isn't read by scripts/advisories.ts (only [[IgnoredVulns]])`);
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) throw new Error(`${at}: not a key = value line`);
    const [, key = '', value = ''] = pair;
    const table = tables[tables.length - 1];
    if (!table) throw new Error(`${at}: ${key} sits outside an [[IgnoredVulns]] table`);
    if (key !== 'id' && key !== 'ignoreUntil' && key !== 'reason') throw new Error(`${at}: ${key} isn't read by scripts/advisories.ts`);
    if (table.values.has(key)) throw new Error(`${at}: ${key} is given twice`);
    table.values.set(key, value.trim());
  });
  return tables.map(({ line, values }) => {
    const at = `osv-scanner.toml, the ignore on line ${String(line)}`;
    const id = tomlString(values.get('id') ?? '');
    const reason = tomlString(values.get('reason') ?? '');
    const until = values.get('ignoreUntil') ?? '';
    const untilMs = tomlMoment(until);
    if (id === null || id.trim() === '') throw new Error(`${at}: needs an id, as a string`);
    if (reason === null || reason.trim() === '') throw new Error(`${at}: needs a reason, as a string`);
    if (untilMs === null) throw new Error(`${at}: needs an ignoreUntil date, as a TOML date (2027-02-01)`);
    return { id: id.trim(), until, untilMs, reason: reason.trim() };
  });
}

// ---- OSV-Scanner -------------------------------------------------------------------------------------------------

const isMalwareId = (id: string): boolean => id.toUpperCase().startsWith('MAL-');

/** OSV-Scanner's JSON (`--format json`): every vulnerability on every package of every lock file it scanned. */
export function osvAdvisories(report: Json): Advisory[] {
  if (!isObject(report) || !Array.isArray(report.results)) throw new Error("isn't OSV-Scanner's JSON (no results)");
  const out: Advisory[] = [];
  for (const result of list(report.results)) {
    for (const entry of list(result.packages)) {
      const pkg = isObject(entry.package) ? entry.package : {};
      const ecosystem = text(pkg.ecosystem);
      const name = text(pkg.name);
      const version = text(pkg.version);
      // OSV groups the ids that are one flaw (a GHSA and its RUSTSEC, say): each vulnerability carries its group's.
      const groups = list(entry.groups).map((group) => strings(group.ids));
      for (const vuln of list(entry.vulnerabilities)) {
        const id = text(vuln.id);
        const ids = unique([id, ...strings(vuln.aliases), ...groups.filter((group) => group.includes(id)).flat()]);
        const affected = list(vuln.affected).filter((item) => {
          const affectedPkg = isObject(item.package) ? item.package : {};
          return text(affectedPkg.name) === name && (text(affectedPkg.ecosystem) === '' || text(affectedPkg.ecosystem) === ecosystem);
        });
        const fixes = unique(affected.flatMap((item) => list(item.ranges).flatMap((range) => list(range.events).map((event) => text(event.fixed))))).filter(
          (fix) => fix !== '',
        );
        const informational = [vuln, ...affected].map((item) => (isObject(item.database_specific) ? text(item.database_specific.informational) : ''));
        out.push({
          ecosystem,
          name,
          version,
          ids,
          summary: text(vuln.summary) || firstLine(text(vuln.details)),
          fixes: fixes.map((fix) => `fixed in ${fix}`),
          sources: ['OSV'],
          malware: ids.some(isMalwareId),
          malwareIds: isMalwareId(id) ? [id] : [],
          unmaintained: informational.includes('unmaintained'),
          nodes: [],
          notes: [],
        });
      }
    }
  }
  return out;
}

// ---- npm's version ranges ----------------------------------------------------------------------------------------

interface Semver {
  core: [number, number, number];
  pre: string[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function semver(value: string): Semver | null {
  const match = SEMVER.exec(value.trim());
  if (!match) return null;
  const [, major = '', minor = '', patch = '', pre] = match;
  return { core: [Number(major), Number(minor), Number(patch)], pre: pre ? pre.split('.') : [] };
}

/** Semver's precedence: the numbers, then a pre-release below its release, its identifiers compared one by one. */
export function compareVersions(a: string, b: string): number | null {
  const left = semver(a);
  const right = semver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (left.pre.length === 0 || right.pre.length === 0) return Math.sign(right.pre.length - left.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumber = /^\d+$/.test(x);
    const yNumber = /^\d+$/.test(y);
    if (xNumber && yNumber && Number(x) !== Number(y)) return Math.sign(Number(x) - Number(y));
    if (xNumber !== yNumber) return xNumber ? -1 : 1;
    if (!xNumber && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Whether an npm range (`<1.5.0`, `>=2.0.0 <2.3.1`, `1.2.3`, `<1.0.0 || >=2.0.0`, `*`: what npm audit's advisories
 * carry) covers a version. Null when the range or the version can't be read (`^1.2`, `1.x`, `1.0.0 - 2.0.0`), and the
 * caller counts the advisory: the safe side.
 */
export function rangeCovers(range: string, version: string): boolean | null {
  if (semver(version) === null || range.trim() === '') return null;
  // Every comparator is read before any is used, so one this can't read anywhere in the range makes it unreadable.
  const alternatives: { operator: string; order: number }[][] = [];
  for (const alternative of range.split('||')) {
    const tokens = alternative.trim().replace(/(<=|>=|<|>|=)\s+/g, '$1').split(/\s+/).filter((token) => token !== '');
    const comparators: { operator: string; order: number }[] = [];
    for (const token of tokens) {
      if (token === '*') continue;
      const [, operator = '=', bound = ''] = /^(<=|>=|<|>|=)?(.+)$/.exec(token) ?? [];
      const order = compareVersions(version, bound);
      if (order === null) return null;
      comparators.push({ operator, order });
    }
    alternatives.push(comparators);
  }
  const holds = ({ operator, order }: { operator: string; order: number }): boolean =>
    operator === '<' ? order < 0 : operator === '<=' ? order <= 0 : operator === '>' ? order > 0 : operator === '>=' ? order >= 0 : order === 0;
  return alternatives.some((comparators) => comparators.every(holds));
}

// ---- npm audit ---------------------------------------------------------------------------------------------------

type LockPackages = Record<string, JsonObject>;

/** package-lock.json's `packages`: every install path with its version and its dev flag. */
export function lockPackages(lock: Json): LockPackages {
  if (!isObject(lock) || !isObject(lock.packages)) throw new Error("isn't a package-lock.json (lockfileVersion 2 or 3, with packages)");
  const out: LockPackages = {};
  for (const [path, entry] of Object.entries(lock.packages)) if (isObject(entry)) out[path] = entry;
  return out;
}

/** `npm audit --json` (its report version 2): each package's own advisories; the packages it lists only as pulling one in are left to that one. */
export function npmAuditAdvisories(report: Json, lock: LockPackages): Advisory[] {
  if (!isObject(report)) throw new Error("isn't npm audit's JSON");
  if (isObject(report.error)) throw new Error(`npm audit failed: ${text(report.error.summary) || text(report.error.code) || 'no reason given'}`);
  if (!isObject(report.vulnerabilities)) throw new Error("isn't npm audit's JSON (no vulnerabilities)");
  const out: Advisory[] = [];
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (!isObject(entry)) continue;
    const nodes = strings(entry.nodes);
    const fix = entry.fixAvailable;
    const fixes = isObject(fix)
      ? [`npm audit fix: ${text(fix.name)}@${text(fix.version)}${fix.isSemVerMajor === true ? ' (a major version)' : ''}`]
      : fix === true
        ? ['npm audit fix']
        : [];
    // One advisory per installed version: npm audit gives install paths, the lock file their versions.
    const byVersion = new Map<string, string[]>();
    for (const node of nodes) {
      const version = text(lock[node]?.version) || 'unknown version';
      byVersion.set(version, [...(byVersion.get(version) ?? []), node]);
    }
    if (byVersion.size === 0) byVersion.set('unknown version', []);
    for (const via of list(entry.via)) {
      const url = text(via.url);
      const ghsa = /GHSA(?:-[a-z0-9]{4}){3}/i.exec(url)?.[0];
      const source = typeof via.source === 'number' || typeof via.source === 'string' ? String(via.source) : '';
      const id = ghsa ?? (source !== '' ? `npm-${source}` : url || 'npm advisory');
      const title = text(via.title);
      const range = text(via.range);
      for (const [version, versionNodes] of byVersion) {
        // Only the installed versions the advisory's range covers; one this can't read covers them all (the red side).
        const covers = rangeCovers(range, version);
        if (covers === false) continue;
        out.push({
          ecosystem: 'npm',
          name,
          version,
          ids: [id],
          summary: title,
          fixes,
          sources: ['npm audit'],
          // GitHub's malware advisories are titled "Malware in <package>"; a flaw's title may say "malicious" too.
          malware: isMalwareId(id) || /^Malware in\b/i.test(title),
          malwareIds: isMalwareId(id) ? [id] : [],
          unmaintained: false,
          nodes: versionNodes,
          notes: covers === null ? [`npm audit's range "${range}" couldn't be read against ${version}, so it counts`] : [],
        });
      }
    }
  }
  return out;
}

// ---- Putting the two together ------------------------------------------------------------------------------------

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** One advisory per flaw and package version: OSV's and npm audit's copies of it merged, by any id they share. */
export function mergeAdvisories(advisories: readonly Advisory[]): Advisory[] {
  const out: Advisory[] = [];
  for (const advisory of advisories) {
    const same = (other: Advisory): boolean =>
      other.ecosystem === advisory.ecosystem &&
      other.name === advisory.name &&
      other.version === advisory.version &&
      other.ids.some((id) => advisory.ids.includes(id));
    const matches = out.filter(same);
    const merged = [...matches, advisory].reduce((a, b) => ({
      ...a,
      ids: unique([...a.ids, ...b.ids]),
      summary: a.summary || b.summary,
      // OSV's fixed versions say more than npm audit's offer; npm audit's stand when OSV lists none.
      fixes: a.fixes.length > 0 ? a.fixes : b.fixes,
      sources: unique([...a.sources, ...b.sources]),
      malware: a.malware || b.malware,
      malwareIds: unique([...a.malwareIds, ...b.malwareIds]),
      unmaintained: a.unmaintained || b.unmaintained,
      nodes: unique([...a.nodes, ...b.nodes]),
      notes: unique([...a.notes, ...b.notes]),
    }));
    // In the place of the first copy, so the order stays the reports' own.
    const [first, ...rest] = matches;
    for (const match of rest) out.splice(out.indexOf(match), 1);
    if (first) out[out.indexOf(first)] = merged;
    else out.push(merged);
  }
  return out;
}

/**
 * `cargo tree`'s crates as name@version, whatever prefix it drew; a duplicate's (*) and a path's brackets left out.
 * The job runs it with `-e normal,no-proc-macro`: a proc macro and what it pulls in run only as the app is compiled.
 */
export function cargoTreeCrates(tree: string): Set<string> {
  const crates = new Set<string>();
  for (const raw of tree.split(/\r?\n/)) {
    const line = raw.replace(/^[\s│├└─|`\\-]*/u, '').replace(/^\d+/, '');
    const [, name, version] = /^([A-Za-z0-9_-]+) v(\d[^\s]*)/.exec(line) ?? [];
    if (name !== undefined && version !== undefined) crates.add(`${name}@${version}`);
  }
  if (crates.size === 0) throw new Error("isn't cargo tree's output (no crates in it)");
  return crates;
}

export interface Context {
  lock: LockPackages;
  trees: { target: string; crates: Set<string> }[];
  ignores: readonly Ignore[];
  now: number;
}

/** Whether an npm package ships: some install of it, at this version, isn't dev only. Unknown to the lock file: it ships. */
function npmShips(advisory: Advisory, lock: LockPackages): boolean {
  const installs =
    advisory.nodes.length > 0
      ? advisory.nodes.map((node) => lock[node]).filter((entry): entry is JsonObject => entry !== undefined)
      : Object.entries(lock)
          .filter(([path, entry]) => (path === `node_modules/${advisory.name}` || path.endsWith(`/node_modules/${advisory.name}`)) && text(entry.version) === advisory.version)
          .map(([, entry]) => entry);
  return installs.length === 0 || installs.some((entry) => entry.dev !== true);
}

export function classify(advisories: readonly Advisory[], context: Context): Finding[] {
  return advisories.map((advisory): Finding => {
    // Malware is silenced only by an ignore of its own MAL- id: one given for a flaw that shares an alias or an OSV
    // group with it never is.
    const matching = context.ignores.filter((ignore) => (advisory.malware ? advisory.malwareIds : advisory.ids).includes(ignore.id));
    const ignore = matching.find((item) => context.now < item.untilMs);
    const ignoreEnded = ignore ? undefined : matching[0];
    const targets =
      advisory.ecosystem === 'crates.io' ? context.trees.filter(({ crates }) => crates.has(`${advisory.name}@${advisory.version}`)).map(({ target }) => target) : [];
    const refused = advisory.malware ? context.ignores.filter((item) => advisory.ids.includes(item.id) && !matching.includes(item)) : [];
    const notes = [...advisory.notes, ...refused.map((item) => `the ignore of ${item.id} doesn't silence malware: only one of its own MAL- id can`)];
    const base = { ...advisory, notes, targets, ...(ignoreEnded ? { ignoreEnded } : {}) };
    if (ignore) return { ...base, verdict: 'ignored', red: false, ignore };
    if (advisory.malware) return { ...base, verdict: 'malware', red: true };
    if (advisory.unmaintained) return { ...base, verdict: 'unmaintained', red: false };
    if (advisory.ecosystem === 'npm' && !npmShips(advisory, context.lock)) return { ...base, verdict: 'dev-only', red: false };
    if (advisory.ecosystem === 'crates.io' && targets.length === 0) return { ...base, verdict: 'linux-or-build', red: false };
    // Anything else (another ecosystem OSV found in a lock file, say) ships until shown otherwise.
    return { ...base, verdict: 'ships', red: true };
  });
}

// ---- Words -------------------------------------------------------------------------------------------------------

export function verdictLabel(finding: Finding): string {
  switch (finding.verdict) {
    case 'ships':
      return finding.targets.length > 0 ? `ships (${finding.targets.join(', ')})` : 'ships';
    case 'malware':
      return 'malware';
    case 'dev-only':
      return 'dev only';
    case 'linux-or-build':
      return 'Linux or build only';
    case 'unmaintained':
      return 'unmaintained';
    case 'ignored':
      return `ignored until ${finding.ignore?.until ?? '?'}`;
  }
}

const fixWords = (finding: Finding): string => (finding.fixes.length > 0 ? finding.fixes.join(', ') : 'no fix listed');

export function findingLine(finding: Finding): string {
  const parts = [
    `${finding.red ? 'RED' : 'ok '}  ${verdictLabel(finding).padEnd(22)}`,
    `${finding.ecosystem} ${finding.name} ${finding.version}`,
    finding.ids.join(' '),
    finding.summary || '(no summary)',
    fixWords(finding),
    `from ${finding.sources.join(' and ')}`,
  ];
  if (finding.ignore) parts.push(`reason: ${finding.ignore.reason}`);
  if (finding.ignoreEnded) parts.push(`its ignore ended ${finding.ignoreEnded.until}`);
  parts.push(...finding.notes);
  return parts.join(' | ');
}

export function summaryLine(findings: readonly Finding[]): string {
  const count = (verdict: Verdict): string => String(findings.filter((finding) => finding.verdict === verdict).length);
  const red = String(findings.filter((finding) => finding.red).length);
  return (
    `${String(findings.length)} finding${findings.length === 1 ? '' : 's'}, ${red} red (${count('ships')} shipped, ${count('malware')} malware); ` +
    `${count('ignored')} ignored, ${count('dev-only')} dev only, ${count('linux-or-build')} Linux or build only, ${count('unmaintained')} unmaintained.`
  );
}

/** The ignores no finding used: a fixed advisory's ignore can go. */
export function unusedIgnores(findings: readonly Finding[], ignores: readonly Ignore[]): Ignore[] {
  return ignores.filter((ignore) => !findings.some((finding) => finding.ids.includes(ignore.id)));
}

const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The job's step summary: the count, then every finding in a table. */
export function markdown(findings: readonly Finding[]): string {
  const rows = findings.map((finding) =>
    [
      finding.red ? '**RED**' : 'ok',
      verdictLabel(finding),
      `${finding.ecosystem} ${finding.name} ${finding.version}`,
      finding.ids.join(' '),
      finding.summary || '(no summary)',
      fixWords(finding),
      [
        ...(finding.ignore ? [finding.ignore.reason] : finding.ignoreEnded ? [`its ignore ended ${finding.ignoreEnded.until}`] : []),
        ...finding.notes,
      ].join('; '),
    ]
      .map(cell)
      .join(' | '),
  );
  return [
    '## Advisories',
    '',
    summaryLine(findings),
    '',
    ...(rows.length > 0 ? ['| | Verdict | Package | Advisory | Summary | Fix | Note |', '|---|---|---|---|---|---|---|', ...rows.map((row) => `| ${row} |`)] : []),
    '',
  ].join('\n');
}

// ---- The job's step ----------------------------------------------------------------------------------------------

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

const OPTIONS = {
  osv: { type: 'string' },
  npm: { type: 'string' },
  'tree-windows': { type: 'string' },
  'tree-mac': { type: 'string' },
  lock: { type: 'string', default: 'package-lock.json' },
  config: { type: 'string', default: 'osv-scanner.toml' },
} as const;

function main(args: string[]): number {
  let parsed: ReturnType<typeof parseArgs<{ args: string[]; options: typeof OPTIONS }>>;
  try {
    parsed = parseArgs({ args, options: OPTIONS });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const { values } = parsed;
  const { osv, npm, lock, config } = values;
  const treeWindows = values['tree-windows'];
  const treeMac = values['tree-mac'];
  if (!osv || !npm || !treeWindows || !treeMac) {
    console.error('Usage: node scripts/advisories.ts --osv <file> --npm <file> --tree-windows <file> --tree-mac <file> [--lock <file>] [--config <file>]');
    return 1;
  }
  const read = <T>(path: string, how: (path: string) => T): T => {
    try {
      return how(path);
    } catch (error) {
      throw new Error(`Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };
  try {
    const packages = read(lock, (path) => lockPackages(readJson(path)));
    const ignores = read(config, (path) => parseIgnores(readFileSync(path, 'utf8')));
    const advisories = mergeAdvisories([
      ...read(osv, (path) => osvAdvisories(readJson(path))),
      ...read(npm, (path) => npmAuditAdvisories(readJson(path), packages)),
    ]);
    const trees = [
      { target: 'Windows', crates: read(treeWindows, (path) => cargoTreeCrates(readFileSync(path, 'utf8'))) },
      { target: 'the Mac', crates: read(treeMac, (path) => cargoTreeCrates(readFileSync(path, 'utf8'))) },
    ];
    const findings = classify(advisories, { lock: packages, trees, ignores, now: Date.now() });
    // Red first, so the reason for a red job is at the top.
    findings.sort((a, b) => Number(b.red) - Number(a.red));
    for (const finding of findings) console.log(findingLine(finding));
    console.log(summaryLine(findings));
    for (const ignore of unusedIgnores(findings, ignores)) console.log(`The ignore of ${ignore.id} (until ${ignore.until}) matched no finding: it can go.`);
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) appendFileSync(summaryFile, markdown(findings));
    return findings.some((finding) => finding.red) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
