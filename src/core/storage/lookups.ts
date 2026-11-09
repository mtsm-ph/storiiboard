import type { JsonValue } from '../model/record';
import type { ProjectFile, Statement } from './driver';
import { UUID_V4 } from './slateNumbers';

// Cached network lookups (schema 11, 3.4, docs/SBD_FORMAT.md): one row per kind of lookup and what was asked, with the
// answer and when it was fetched. Asked again, the row is replaced. Written outside the edit log, as read state is.

/** The kinds of lookup: the address search now; weather and the nearest hospital come with Phase 4. */
export type LookupKind = 'address_search';

export interface Lookup {
  result: JsonValue;
  /** ISO time the answer came from the network. */
  fetchedAt: string;
}

/** The cached answer to `key`, or null for none (or one this version can't read). */
export async function loadLookup(file: ProjectFile, kind: LookupKind, key: string): Promise<Lookup | null> {
  const [row] = await file.query('SELECT result, fetched_at FROM lookups WHERE kind = ? AND query_key = ?', [kind, key]);
  if (!row || typeof row.result !== 'string' || typeof row.fetched_at !== 'string' || Number.isNaN(Date.parse(row.fetched_at))) return null;
  try {
    return { result: JSON.parse(row.result) as JsonValue, fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

/** An answer kept for `key`, replacing an older one. */
export function lookupStatement(kind: LookupKind, key: string, query: string, result: JsonValue, at: string): Statement {
  return {
    sql: `INSERT INTO lookups (id, kind, query_key, query, result, fetched_at, created_at, updated_at)
      VALUES (${UUID_V4}, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, query_key) DO UPDATE SET query = excluded.query, result = excluded.result,
        fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`,
    params: [kind, key, query, JSON.stringify(result), at, at, at],
  };
}
