import type { ProjectFile } from './driver';
import { setMeta } from './migrate';

// Named versions (1.23, schema 4, docs/SBD_FORMAT.md): "Board sent to client", "Locked for shoot". Each names the last
// op group it includes. Naming, renaming and deleting one are not edits to the project, so they're not in History and
// undo leaves them alone; deleting one asks first.

export interface NamedVersion {
  id: string;
  name: string;
  note: string | null;
  /** The last step it includes. */
  opGroupId: string;
  createdBy: string;
  createdAt: string;
}

/** Every named version, newest first. */
export async function listVersions(file: ProjectFile): Promise<NamedVersion[]> {
  const rows = await file.query(
    `SELECT v.id, v.name, v.note, v.op_group_id, v.created_by, v.created_at FROM versions v
      JOIN op_groups g ON g.id = v.op_group_id ORDER BY g.seq DESC, v.created_at DESC`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    opGroupId: String(row.op_group_id),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  }));
}

/** A version name as typed, tidied; null when there's nothing to name it. */
export function versionName(typed: string): string | null {
  const name = typed.trim().replace(/\s+/g, ' ');
  return name === '' || name.length > 80 ? null : name;
}

export async function nameVersion(
  file: ProjectFile,
  version: { name: string; note?: string | null; opGroupId: string; createdBy?: string },
  now = new Date(),
): Promise<string> {
  const id = crypto.randomUUID();
  const at = now.toISOString();
  await file.tx([
    {
      sql: 'INSERT INTO versions (id, name, note, op_group_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: [id, version.name, version.note ?? null, version.opGroupId, version.createdBy ?? 'local', at, at],
    },
  ]);
  return id;
}

export async function renameVersion(file: ProjectFile, id: string, name: string, now = new Date()): Promise<void> {
  await file.tx([{ sql: 'UPDATE versions SET name = ?, updated_at = ? WHERE id = ?', params: [name, now.toISOString(), id] }]);
}

/** Deletes a named version (after a confirm). The steps it named stay in History. */
export async function deleteVersion(file: ProjectFile, id: string): Promise<void> {
  await file.tx([{ sql: 'DELETE FROM versions WHERE id = ?', params: [id] }]);
}

/** Gives a copy a file id of its own, so its local backups never mix with the original's (docs/PLAN.md, F). */
export function freshFileId(file: ProjectFile, now = new Date()): Promise<void> {
  return file.tx([setMeta('file_id', crypto.randomUUID(), now)]);
}
