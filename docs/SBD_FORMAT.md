# The .sbd file format

**Status: draft.** Schema v1 is built in milestone 0.4; until then this file is the plan for it. Every schema change is
recorded here, and the schema changes only with Kevin's approval (CLAUDE.md).

## The file

- One project is one .sbd file, which is one SQLite 3 database.
- Journal mode is `DELETE` with `synchronous = FULL`, not WAL. WAL keeps -wal and -shm files next to the project, and
  Dropbox or email can split them from it; the rollback journal keeps a project to one file at rest.
- Video stays outside the file as a linked path or cloud link, plus a cached thumbnail. Media paths are stored relative
  to the .sbd when possible, absolute otherwise.

## Conventions

- Every table has `id` (UUID v4, text), `created_at` and `updated_at`.
- Timestamps are ISO 8601 text in UTC, for example `2026-11-02T14:05:00.000Z`.
- JSON columns are text that holds a JSON value.

## Schema v1 (milestone 0.4)

### meta

| Column | Type | Notes |
|---|---|---|
| key | text, unique | |
| value | text | |

Keys: `schema_version` (1), `app_version` and `undo_cursor`.

### records

| Column | Type | Notes |
|---|---|---|
| type | text | One of the record types in CLAUDE.md, such as `scene`, `shot` or `media` |
| parent_id | text, null for the project | The parent record |
| sort_key | text | Fractional key that orders siblings, so a reorder rewrites one row instead of the parent |
| props | JSON | The record's properties, custom ones included. Changing `type` keeps every prop |
| archived_at | text, null while live | When the record was archived (see Archive) |
| archived_by | text, null while live | Who archived it: the op author, `local` until people sign in |

### ops

| Column | Type | Notes |
|---|---|---|
| seq | integer, unique | Order of the log, which UUIDs can't give |
| group_id | text | One user action; undo and redo move a whole group |
| record_id | text | |
| kind | text | `create`, `update` (props patch), `move` (parent and sort key), `retype` (keeps every prop), `archive`, `restore` |
| before, after | JSON | The record either side of the op |
| author | text | `local` for now |
| timestamp | text | When the edit happened |
| state | text | `applied`, `undone`, or `discarded` (a redo tail dropped by a new edit) |

The media and thumbnail tables come in a later migration, in the phase that first stores images.

## Archive

- Deleting a frame, shot, scene, note or media item is an `archive` op. It sets `archived_at` and `archived_by`, and
  undo clears them. Restoring from the Archive is a `restore` op, so a restore can be undone too.
- Views, rollups, call sheets, checks and MCP reads skip records with `archived_at` set unless the caller asks for them.
- "Empty archive" deletes archived records for good, after a confirm. How it treats children, media bytes and older ops
  is open until Phase 1 (docs/PLAN.md, Open questions).

## Backups (milestone 0.4)

- Every 5 minutes while a project is open, and only if it changed since the last backup, a full copy is written to
  `Backups/<Project> YYYY-MM-DD HH-mm.sbd` in the folder that holds the .sbd. `<Project>` is the .sbd's file name and
  the time is local, for example `Backups/Bey County 2026-11-02 14-05.sbd`.
- Copies are made with SQLite's online backup API or `VACUUM INTO`, so they're consistent while the project is open.
  The file is never copied with a raw file copy. Each backup is a complete .sbd that opens on its own.
- Pruning keeps the newest 12 backups plus the newest one from each of the last 14 days, and deletes the rest. Both
  numbers are in Settings. Pruning touches only this project's own backups, never other files in the folder.
- "Open backup" opens a copy of the backup as a separate project. The original is never overwritten without asking.
- Migration backups (`<name>.sbd.bak-v<from>-<date>`, made before any migration) are separate and are never pruned.

## Planned changes

### Notification read state (Phase 3)

The notification feed isn't stored: like every rollup, it's computed from ops, suggestions and comments. What is stored
is each person's read state, in two tables.

`notification_cursors`

| Column | Type | Notes |
|---|---|---|
| user_id | text, unique | `local` on the desktop until people sign in |
| read_through | text | Everything up to this time counts as read, which is how "Mark all as read" works |

`notification_reads`

| Column | Type | Notes |
|---|---|---|
| user_id | text | |
| item_kind | text | `op_group`, `suggestion` or `comment` |
| item_id | text | The op group id, or the suggestion or comment record id |
| read_at | text | |

- `notification_reads` is unique on (`user_id`, `item_kind`, `item_id`). Rows older than a user's `read_through` are
  deleted when it moves.
- Read state isn't an op: marking an item read can't be undone and doesn't appear in the feed.
- Web users' read state lives in Supabase (Phase 9), because the web never edits the .sbd.

## Change log

| Schema | Milestone | Change |
|---|---|---|
| 1 | 0.4 (planned) | First schema: meta, records (with `archived_at` and `archived_by`), ops |
| 2 | Phase 3 (planned) | Notification read state: `notification_cursors`, `notification_reads` |
