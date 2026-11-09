import type { Migration } from '../migrate';

// Schema v11 (3.4, additive: approved Nov 9): every lookup the app makes on the network, cached in the project with
// when it was fetched (CLAUDE.md, Network rules), so a search pressed twice asks once, and the answer is there offline.
// The address search is the first kind; weather, routes and the nearest hospital (Phase 4) join it. Not an op: a cache
// isn't a step in History and isn't undone. migrate() backs the file up before this runs, as before every migration.

export const lookups: Migration = {
  version: 11,
  description: 'Cached network lookups: lookups',
  statements: [
    {
      sql: `CREATE TABLE lookups (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        query_key TEXT NOT NULL,
        query TEXT NOT NULL,
        result TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (kind, query_key)
      ) STRICT`,
    },
  ],
};
