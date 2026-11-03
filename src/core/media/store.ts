import type { Props } from '../model/record';
import type { ProjectFile, Statement } from '../storage/driver';

// Images in the .sbd (schema 3, docs/SBD_FORMAT.md): the bytes in media_files and thumbnails, content-addressed by
// SHA-256, and a `media` record that points at them. This module writes and reads the bytes; image.ts makes them.

export interface StoredFile {
  sha256: string;
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

/** A picture ready to store: the original (capped, colour kept) and the thumbnail the board draws. */
export interface PreparedImage {
  original: StoredFile & { colorSpace: 'display-p3' | 'srgb' };
  thumbnail: Omit<StoredFile, 'sha256'> & { longEdge: number };
}

/** Where a picture came from, kept as a pointer only: the file itself is never copied in besides the stored image. */
export interface ImageSource {
  /** The file's name as the person saw it, for the inspector. */
  name?: string;
  /**
   * Its path, so a later full-resolution export can use the original if it's still there (Kevin, Nov 2). Relative to
   * the .sbd when it's under the project's folder, absolute otherwise (CLAUDE.md).
   */
  path?: string;
}

/**
 * The statements that store a picture's bytes, for the same transaction as the record that uses it (OpOptions
 * alsoWrite). INSERT OR IGNORE: a picture already in the file, such as one used in two frames, isn't written twice.
 */
export function imageStatements(image: PreparedImage, now: Date): Statement[] {
  const at = now.toISOString();
  const { original, thumbnail } = image;
  return [
    {
      sql: `INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        crypto.randomUUID(),
        original.sha256,
        original.bytes,
        original.mime,
        original.width,
        original.height,
        original.bytes.length,
        original.colorSpace,
        at,
        at,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO thumbnails (id, sha256, long_edge, bytes, mime, width, height, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        crypto.randomUUID(),
        original.sha256,
        thumbnail.longEdge,
        thumbnail.bytes,
        thumbnail.mime,
        thumbnail.width,
        thumbnail.height,
        at,
        at,
      ],
    },
  ];
}

/** `/Films/Bey County/refs/still.jpg` from `/Films/Bey County/Bey County.sbd` → `refs/still.jpg`. */
export function relativeToProject(path: string, projectPath: string): string {
  const split = (p: string) => p.split(/[/\\]/);
  const folder = split(projectPath).slice(0, -1);
  const parts = split(path);
  const inside = folder.length > 0 && folder.every((part, i) => parts[i] === part);
  return inside ? parts.slice(folder.length).join('/') : path;
}

/** The media record's props for a stored picture. */
export function mediaProps(image: PreparedImage, source: ImageSource = {}, projectPath?: string): Props {
  const { original } = image;
  return {
    kind: 'image',
    file: original.sha256,
    mime: original.mime,
    width: original.width,
    height: original.height,
    color_space: original.colorSpace,
    ...(source.name ? { source_name: source.name } : {}),
    ...(source.path ? { source_path: projectPath ? relativeToProject(source.path, projectPath) : source.path } : {}),
  };
}

/** A media record's picture as views read it: enough to lay out a frame without reading the bytes. */
export interface MediaFields {
  sha256: string;
  width: number;
  height: number;
  sourceName: string;
  sourcePath: string;
}

/** A media record's picture, or null when it isn't a stored image (another kind, or props it can't read). */
export function mediaFields(props: Props): MediaFields | null {
  const { kind, file, width, height } = props;
  if (kind !== 'image' || typeof file !== 'string' || !/^[0-9a-f]{64}$/.test(file)) return null;
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null;
  return {
    sha256: file,
    width,
    height,
    sourceName: typeof props.source_name === 'string' ? props.source_name : '',
    sourcePath: typeof props.source_path === 'string' ? props.source_path : '',
  };
}

export interface ReadFile {
  bytes: Uint8Array;
  mime: string;
}

/** A stored original's bytes and type, or null if this file doesn't hold it. */
export async function readOriginal(file: ProjectFile, sha256: string): Promise<ReadFile | null> {
  const [row] = await file.query('SELECT mime FROM media_files WHERE sha256 = ?', [sha256]);
  if (!row) return null;
  const bytes = await file.readBlob('SELECT bytes FROM media_files WHERE sha256 = ?', [sha256]);
  return bytes ? { bytes, mime: String(row.mime) } : null;
}

/** A stored picture's thumbnail, falling back to the original for a file that has none. */
export async function readThumbnail(file: ProjectFile, sha256: string): Promise<ReadFile | null> {
  const [row] = await file.query('SELECT mime, long_edge FROM thumbnails WHERE sha256 = ? ORDER BY long_edge LIMIT 1', [sha256]);
  if (!row) return readOriginal(file, sha256);
  const bytes = await file.readBlob('SELECT bytes FROM thumbnails WHERE sha256 = ? AND long_edge = ?', [sha256, Number(row.long_edge)]);
  return bytes ? { bytes, mime: String(row.mime) } : null;
}
