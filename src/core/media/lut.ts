import type { ProjectFile, Statement } from '../storage/driver';

// LUTs for videos (2.5, docs/SBD_FORMAT.md `luts`): a `.cube` file's text, stored once per project by its SHA-256 and
// named by a video's `lut` prop, so loading or changing one is an edit like any other and undoes. A LUT grades the
// video's playback copy (and, from 2.7, its stills), never the original.

/** A `.cube` read and checked, ready to store. */
export interface PreparedLut {
  sha256: string;
  /** Shown in the app: the file name without `.cube`. */
  name: string;
  /** As loaded: `SLog3SGamut3.CineToLC-709.cube`. */
  fileName: string;
  /** The file's text, as it was. */
  cube: string;
}

/** Why a file isn't a LUT the app can use; each has words in the translation files (`lut.<reason>`). */
export type LutProblem = 'notCube' | 'oneD' | 'size' | 'rows' | 'domain';

/** A LUT in the project, for the inspector's list: everything but its text. */
export interface LutRow {
  id: string;
  sha256: string;
  name: string;
  fileName: string;
}

/** What ffmpeg reads: the size, the domain if it isn't 0 to 1, and the rows; nothing else from the file. */
export interface CubeForCopy {
  sha256: string;
  cube: string;
}

/** The largest grid FFmpeg's lut3d takes (its MAX_LEVEL). Cameras ship 33 and 65. */
const MAX_SIZE = 256;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function numbers(parts: readonly string[]): number[] | null {
  if (parts.length !== 3 || !parts.every((part) => NUMBER.test(part))) return null;
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

/**
 * A `.cube` (Adobe's and Resolve's format) read by its rules: comments and a TITLE skipped, LUT_3D_SIZE from 2 to 256,
 * an optional DOMAIN_MIN and DOMAIN_MAX, then size³ rows of three numbers. A 1D LUT (LUT_1D_SIZE), or a 1D shaper
 * before a 3D one, is refused: FFmpeg's lut3d takes the 3D kind only. On success, the text ffmpeg is given: the same
 * LUT with nothing it might trip on (a keyword it doesn't know, a title between the rows).
 */
export function readCube(text: string): { ok: true; size: number; forCopy: string } | { ok: false; problem: LutProblem } {
  let size: number | null = null;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const rows: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [word = '', ...rest] = line.split(/\s+/);
    if (NUMBER.test(word)) {
      if (size === null) return { ok: false, problem: 'notCube' };
      const values = numbers([word, ...rest]);
      if (!values) return { ok: false, problem: 'rows' };
      rows.push(values.join(' '));
      continue;
    }
    // Keywords come before the rows.
    if (rows.length > 0) return { ok: false, problem: 'rows' };
    if (word === 'LUT_1D_SIZE') return { ok: false, problem: 'oneD' };
    if (word === 'LUT_3D_SIZE') {
      const n = rest.length === 1 && /^\d+$/.test(rest[0] ?? '') ? Number(rest[0]) : NaN;
      if (!(n >= 2 && n <= MAX_SIZE)) return { ok: false, problem: 'size' };
      size = n;
    } else if (word === 'DOMAIN_MIN' || word === 'DOMAIN_MAX') {
      const values = numbers(rest);
      if (!values) return { ok: false, problem: 'domain' };
      if (word === 'DOMAIN_MIN') min = values;
      else max = values;
    }
    // TITLE, LUT_3D_INPUT_RANGE and the like: names and notes, not the LUT.
  }
  if (size === null) return { ok: false, problem: 'notCube' };
  if (rows.length !== size ** 3) return { ok: false, problem: 'rows' };
  if (!min.every((low, i) => low < (max[i] ?? low))) return { ok: false, problem: 'domain' };
  const domain =
    min.join(' ') === '0 0 0' && max.join(' ') === '1 1 1' ? [] : [`DOMAIN_MIN ${min.join(' ')}`, `DOMAIN_MAX ${max.join(' ')}`];
  return { ok: true, size, forCopy: [`LUT_3D_SIZE ${String(size)}`, ...domain, ...rows, ''].join('\n') };
}

async function sha256Of(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A `.cube` file, checked and ready to store, or why it can't be used. */
export async function prepareLut(fileName: string, text: string): Promise<{ ok: true; lut: PreparedLut } | { ok: false; problem: LutProblem }> {
  const read = readCube(text);
  if (!read.ok) return read;
  const name = fileName.replace(/\.cube$/i, '') || fileName;
  return { ok: true, lut: { sha256: await sha256Of(text), name, fileName, cube: text } };
}

/** The LUT already in the project with this content, if any: loaded twice, it's stored once. */
export async function lutWithSha(file: ProjectFile, sha256: string): Promise<string | null> {
  const [row] = await file.query('SELECT id FROM luts WHERE sha256 = ?', [sha256]);
  return row ? String(row.id) : null;
}

/** The statement that stores a LUT, for the same transaction as the edit that sets it (OpOptions alsoWrite). */
export function lutStatements(id: string, lut: PreparedLut, now: Date): Statement[] {
  const at = now.toISOString();
  return [
    {
      sql: `INSERT OR IGNORE INTO luts (id, sha256, name, file_name, byte_size, created_at, updated_at, cube)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, lut.sha256, lut.name, lut.fileName, new TextEncoder().encode(lut.cube).length, at, at, lut.cube],
    },
  ];
}

/** The project's LUTs, by name, without their text. */
export async function listLuts(file: ProjectFile): Promise<LutRow[]> {
  const rows = await file.query('SELECT id, sha256, name, file_name FROM luts ORDER BY name COLLATE NOCASE, id');
  return rows.map((row) => ({ id: String(row.id), sha256: String(row.sha256), name: String(row.name), fileName: String(row.file_name) }));
}

/** A LUT as a playback copy is made with it: its SHA-256 (in the copy's key) and the text ffmpeg reads. */
export async function lutForCopy(file: ProjectFile, id: string): Promise<CubeForCopy | null> {
  const [row] = await file.query('SELECT sha256, cube FROM luts WHERE id = ?', [id]);
  if (!row) return null;
  const read = readCube(String(row.cube));
  return read.ok ? { sha256: String(row.sha256), cube: read.forCopy } : null;
}
