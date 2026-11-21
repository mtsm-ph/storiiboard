import { basename } from 'node:path';
import type { SbdRecord } from '../../src/core/model/record';
import type { SlateNumbers } from '../../src/core/model/shotNumbers';
import { loadRecords } from '../../src/core/ops/ops';
import { SCHEMA_VERSION } from '../../src/core/storage/migrations';
import { loadSeen, type Seen } from '../../src/core/storage/seen';
import { loadSlateNumbers } from '../../src/core/storage/slateNumbers';
import { openReadOnly, ProjectRefused } from './readOnlyFile';

// One project as the tools read it: every record, its Seen marks and slate numbers, read in one go from a read-only
// connection that is closed straight after, so each call reads the file as it is then (the app may have saved since)
// and nothing stays open between calls. The reads run in one transaction (round 2), so a save landing between two of
// them can't give the records of one moment and the slate numbers of the next.

export type Records = Readonly<Record<string, SbdRecord>>;

export interface ProjectData {
  path: string;
  /** The .sbd's name without the extension, as the app names the project. */
  name: string;
  projectId: string;
  schemaVersion: number;
  records: Records;
  seen: Seen;
  slate: SlateNumbers;
}

export async function readProject(path: string): Promise<ProjectData> {
  const file = openReadOnly(path);
  try {
    return await file.snapshot(async () => {
      const list = await loadRecords(file);
      const records: Record<string, SbdRecord> = {};
      for (const record of list) records[record.id] = record;
      const project = list.find((r) => r.type === 'project' && r.parentId === null);
      if (!project) throw new ProjectRefused("This file isn't a Storiiboard project.");
      const seen = await loadSeen(file);
      const slate = await loadSlateNumbers(file);
      return { path, name: basename(path).replace(/\.sbd$/i, ''), projectId: project.id, schemaVersion: SCHEMA_VERSION, records, seen, slate };
    });
  } finally {
    await file.close();
  }
}
