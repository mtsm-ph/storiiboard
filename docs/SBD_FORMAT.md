# The .sbd file format

**Status:** schema v1, backups and migrations are built (milestone 0.4); sections marked planned aren't yet. Every
schema change is recorded here, and the schema changes only with Kevin's approval (CLAUDE.md).

## The file

- One project is one .sbd file, which is one SQLite 3 database.
- Journal mode is `DELETE` with `synchronous = FULL`, not WAL. WAL keeps -wal and -shm files next to the project, and
  Dropbox or email can split them from it; the rollback journal keeps a project to one file at rest.
- `fullfsync = ON` as well: on a Mac, plain fsync leaves a commit in the drive's cache, so a power cut could still lose
  it. `foreign_keys = ON`.
- The desktop app opens files through Rust (src-tauri/src/sbd.rs); tests and the MCP server use Node's built-in SQLite
  with the same settings (src/core/storage/nodeDriver.ts).
- Video stays outside the file as a linked path or cloud link, plus a cached thumbnail. Media paths are stored relative
  to the .sbd when possible, absolute otherwise.

## Conventions

- Every table has `id` (UUID v4, text), `created_at` and `updated_at`.
- Timestamps are ISO 8601 text in UTC, for example `2026-11-02T14:05:00.000Z`.
- JSON columns are text that holds a JSON value.
- Colours are `#RRGGBB` text.

## Schema v2 (milestone 0.4, History made append-only after 0.5)

Schema v1 (0.4) had meta, records and ops. v2 adds op_groups and drops `ops.state`, so the log is only ever appended
to (see Change log). Every table is `STRICT`, so SQLite enforces the column types. JSON columns are checked with `json_valid`. Kinds
and states aren't checked by SQLite: changing a CHECK means rebuilding the table, and later phases add op kinds.

### meta

| Column | Type | Notes |
|---|---|---|
| key | text, unique | |
| value | text | |

Keys: `schema_version` (2), and `app_version`, the app that last opened the file. v1 files written by 0.5 also had
`undo_cursor`; schema 2 removes it, since the undo position now lives in op_groups.

### records

| Column | Type | Notes |
|---|---|---|
| type | text | One of the record types in CLAUDE.md, such as `scene`, `shot` or `media` |
| parent_id | text, null for the project | The parent record. A foreign key checked at commit, so one op group can create a parent and its children in any order |
| sort_key | text | Fractional key that orders siblings, so a reorder rewrites one row instead of the parent |
| props | JSON | The record's properties, custom ones included. Changing `type` keeps every prop |
| trashed_at | text, null while live | When the record went to the Trash (see Trash) |
| trashed_by | text, null while live | Who sent it there: the op author, `local` until people sign in |

Indexes: `records_by_parent (parent_id, sort_key)` for ordered children, and `records_by_type (type)`.

Every file has exactly one record of type `project`, with no parent; every other record hangs below it. It's written
with the file (or when a file without one is opened), not as an op, so undo can never remove it. Its props start as
`title` (the file's name) and `notes`.

`sort_key` is a base-62 string compared byte by byte, never ending in `0`, so a key always fits between any two
(src/core/ops/order.ts).

### ops

| Column | Type | Notes |
|---|---|---|
| seq | integer, unique | Order of the log, which UUIDs can't give. It follows the order of the groups: every op in a group has a higher seq than every op in earlier groups |
| group_id | text | The op group it belongs to (op_groups.id) |
| record_id | text | |
| kind | text | `create`, `update` (props patch), `move` (parent and sort key), `retype` (keeps every prop), `trash`, `restore` (from the Trash), or `revert` (set back by a restore group). An undo or redo group's ops keep the kind of the op they reverse or replay |
| before, after | JSON | The whole record either side of the op, as its row with `props` as an object: `id`, `type`, `parent_id`, `sort_key`, `props`, `trashed_at`, `trashed_by`, `created_at`, `updated_at`. Null where there's no record on that side (before a create) |
| author | text | `local` for now |
| timestamp | text | When the edit happened |

Indexes: `ops_by_group (group_id)` for undo, and `ops_by_record (record_id, seq)` for an item's history.

### op_groups (schema 2)

One row per op group: one user action, or one undo, redo or restore.

| Column | Type | Notes |
|---|---|---|
| seq | integer, unique | Order of the groups |
| kind | text | `edit`, `undo`, `redo` or `restore` |
| target_group_id | text, null | For `undo` and `redo`: the group undone or redone |
| restore_to | text, null | For `restore`: the group whose end state the project went back to; null for the project as created |
| stack_below | text, null | On `edit` and `restore`: the group ⌘Z takes once this one is undone. On `undo`: the group ⌘⇧Z takes once the undone group is redone. Null on `redo` |
| undo_top, redo_top | text, null | The next group ⌘Z and ⌘⇧Z would take, as of the end of this group. Null when that stack is empty |
| author | text | `local` for now |
| timestamp | text | When it happened |

Index: `op_groups_by_target (target_group_id, seq)`, for redo. `target_group_id`, `restore_to`, `stack_below`,
`undo_top` and `redo_top` all point at op_groups rows; an edit's or restore's `undo_top` is the row itself.
`stack_below`, `undo_top` and `redo_top` are worked out from the log as each group is written: they thread the undo and
redo stacks through it, so ⌘Z reads two rows instead of replaying every group.

### How undo, redo and restore use the log

The log is append-only: no op or op_groups row is ever changed or deleted, except by Empty Trash (below).

- One user action is one `edit` group. Its record writes, op rows and group row commit in one transaction. That
  transaction is the autosave.
- Undo is a new `undo` group for the newest group's `undo_top`. Its ops write each record's `before` back (deleting
  records the group created), so each one swaps the undone op's before and after.
- Redo is a new `redo` group for the newest group's `redo_top`. Its ops write `after` again, so they copy the redone
  group's ops.
- A new edit or restore empties the redo stack (`redo_top` null), as in every editor. The undone groups stay in the
  log, and a restore can still bring them back.
- Restore to point P (any group, or the project as created) is a new `restore` group. For each record touched after
  P, the `before` of its first op after P is its state at P, since every record write goes through the log. Records
  that already match are left out, and a restore with nothing to change writes no group. Undo reverses a restore like
  any edit.
- The project record is written with the file, not as an op, so neither undo nor a restore to the start can remove it.

The ops and op_groups tables are the project's History. It's kept for the life of the project: undo, the History panel, named versions
and notifications all read it. Media that any op refers to is kept too, so undo and named versions can bring an old
image back. Only Empty Trash removes data from it.

The media and thumbnail tables come in a later migration, in the phase that first stores images (schema 3, below).

## Trash

The Trash holds deleted items until they're restored or the Trash is emptied. It's separate from an archived project
(the project's `state`, below): the names differ in the UI, the code and this file so the two never mix.

- Deleting a frame, shot, scene, note or media item is a `trash` op. It sets `trashed_at` and `trashed_by`, and undo
  clears them. Restoring from the Trash is a `restore` op, so a restore can be undone too.
- Trashing a scene trashes its shots in the same op group, so one restore brings the whole scene back.
- A deletion approved from a change file is the same `trash` op, with the approver as `trashed_by`. Its op group also
  marks the suggestion approved, so undoing the approval undoes both.
- Views, rollups, call sheets, checks and MCP reads skip records with `trashed_at` set unless the caller asks for them.
- Empty Trash, after a confirm, deletes the trashed records, their children and their media bytes for good. Older ops
  that touched them lose those records' data and can no longer be undone. Named versions lose them too; backups keep
  them until they're pruned.

## Project record props

These need no table change: they're props on the project record. They're listed because the web review copy, exports
and MCP read them.

| Prop | Value | Notes |
|---|---|---|
| state | `draft`, `active` or `archived` | Archive Project sets `archived`. New projects start as `draft`, as in the prototype; a missing value reads as `active`. A Notion-style production stage (Discovery to Complete), when it comes, is a separate `stage` prop |
| theme | object (below) | Phase 1 |
| watermark | `text`, `position`, `opacity` (0 to 1), `applies_to` (any of `pdf`, `png`, `review`) | Phase 1, with export |

Changing any of them is an op, so it undoes and shows in History.

### theme

| Field | Notes |
|---|---|
| version | 1 |
| source | `default` (no image: the kit's theme), `image` (from the logo or key image) or `manual` (accent typed in) |
| image_id | The `media` record of the logo or key image; null for `default` |
| mode | `light` or `dark`: the project's preferred mode. A person's Appearance setting can override it |
| candidates | The extracted accents, most saturated first, usually 3 or 4 |
| accent_picked | The accent the person chose or typed, before the contrast adjustment |
| family | The background family the accent's hue snapped to: one of `paper`, `sand`, `clay`, `rose`, `plum`, `violet`, `navy`, `slate`, `teal`, `sage`, `olive`, `ochre` |
| generator | Version of the generator that produced `tokens` |
| tokens | `light` and `dark`, each with `bg`, `surface`, `surface_raised`, `border`, `border_top`, `text`, `text_muted`, `text_inverse`, `accent`, `accent_contrast` |

- The tokens are stored, not recomputed when the project opens, so a newer generator never changes an approved look.
  Regenerate in Settings → Theme recomputes them on purpose.
- A project with no `theme` uses the default theme. The schema 3 migration writes the default theme into older files,
  so every file states its theme.

## Migrations (milestone 0.4)

- Migrations live in src/core/storage/migrations, numbered from 1; a file's schema version is the number it has run.
- Before upgrading an existing file, a full copy is written beside it as
  `<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm` (local time). Migration backups are never pruned.
- Each migration runs in its own transaction together with its `schema_version` bump, so a failure leaves the file at
  the last version that completed.
- A file from a newer schema is refused, unchanged, with "Update Storiiboard to open it".
- A file without a `meta` table is refused as "not a Storiiboard project", unless the app has just created it empty.
  Nothing is added to a file that isn't a project.

## Backups (milestone 0.4)

- Every 5 minutes while a project is open, and only if it changed since the last backup, a full copy is written to
  `Backups/<Project> YYYY-MM-DD HH-mm.sbd` in the folder that holds the .sbd. `<Project>` is the .sbd's file name and
  the time is local, for example `Backups/Bey County 2026-11-02 14-05.sbd`.
- Copies are made with SQLite's online backup API or `VACUUM INTO`, so they're consistent while the project is open.
  The file is never copied with a raw file copy. Each backup is a complete .sbd that opens on its own.
- "Changed" means a row was written through the open connection since the last backup. Opening a project (its
  migration, its `app_version`) doesn't count, so opening alone never makes a backup.
- Pruning runs after each backup. It keeps the newest 12 backups, plus the newest one from each of the last 14 calendar
  days (today included), and deletes the rest. Both numbers become settings in 0.7.
- Pruning touches only this project's own backups, never other files in the folder: names are made and parsed in
  src/core/storage/backups.ts, and the Rust side refuses to write or delete any name that isn't this project's.
- "Open backup" opens a copy of the backup as a separate project. The original is never overwritten without asking.
- Migration backups (`<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm`, made before any migration) are separate and are never
  pruned.

## Change files (.sbdchanges)

Suggestions made on the web review copy come back to the desktop as a change file. Importing one never edits the
project: it adds the suggestions to the review queue, where a person approves or rejects each one. The desktop imports
change files from Phase 7; the web writes them from Phase 9.

A change file is one UTF-8 JSON object:

```json
{
  "format": "storiiboard.changes",
  "version": 1,
  "id": "8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11",
  "project_id": "0b6e2d0a-3f5c-4d8e-9c1a-7e2f4b5a6c3d",
  "review_copy": { "id": "c41d…", "published_at": "2026-11-20T18:00:00.000Z" },
  "created_at": "2026-11-21T09:12:00.000Z",
  "created_by": "web",
  "people": [
    { "id": "r1", "name": "Ana Ruiz", "role": "client", "person_id": "5a9e…" }
  ],
  "suggestions": [
    {
      "id": "f2b7…",
      "kind": "trash",
      "target": { "id": "9c3e…", "type": "shot", "label": "SC 04 · 4B", "updated_at": "2026-11-20T17:41:09.000Z" },
      "author": "r1",
      "created_at": "2026-11-21T09:10:31.000Z",
      "note": "We have this in 4A.",
      "data": {}
    }
  ]
}
```

| Field | Notes |
|---|---|
| format, version | `version` goes up only for a change an older app can't read safely. Adding a kind or an optional field doesn't change it. An app refuses a newer version with "made by a newer Storiiboard" |
| id | This file's id |
| project_id | The project record's id. A file for another project is refused |
| review_copy | The published review copy the suggestions were made on |
| created_by | What wrote the file: `web` for now |
| people | Who made the suggestions: name, Team role and, when known, their `person` record. Never contact details |
| suggestions[].id | Becomes the suggestion record's id, so importing the same file twice adds nothing |
| suggestions[].kind | What's suggested (below) |
| suggestions[].target | The record, its type, a label as the reviewer saw it, and its `updated_at` in the review copy |
| suggestions[].data | Kind-specific; empty for `trash` |

Kinds:

| Kind | Means | Status |
|---|---|---|
| `trash` | Delete this shot or scene. Approved, it's a `trash` op, so the item goes to the Trash | v1 |
| `comment` | A comment on a frame, plan or call sheet | Reserved |
| `reorder` | Move an item to a new position or parent | Reserved |
| `update` | Change some props | Reserved |
| `create` | Add a shot or scene. Rejected, the proposal goes to the Trash so it can be recovered | Reserved |
| `restore` | Bring an item back from the Trash (the web's Trash view) | Reserved |

Importing:

- The file is untrusted input. It's checked against the format before anything is stored, it's limited to 5 MB, and
  its text is shown as text. Names in it are what the web reported; that's one reason every suggestion still needs a
  person's approval.
- Each suggestion becomes a `suggestion` record, all in one op group, so undoing the import removes them. Its props:
  `kind`, `target_id`, `status` (`pending`, `approved`, `rejected`), `source` (`change_file`, or `mcp` for AI
  suggestions), `change_file_id`, `author`, `note`, `data`, and `decided_by` and `decided_at` once decided.
- The review screen flags a suggestion whose target changed after the review copy was published (the project's
  `updated_at` is newer), one whose target is no longer in the project, and one whose target is already in the Trash.
- Unknown kinds and unknown fields are kept as they are, shown as "needs a newer Storiiboard", and never applied or
  dropped.
- Rejecting a suggestion changes nothing in the project; the suggestion stays, `rejected`, in the review log.

## File type

The installers register `.sbd` as "Storiiboard Project", with Storiiboard as its owner, so a double-click opens it.
On macOS the exported type is `app.storiiboard.project`, conforming to `public.data` and `public.database`; the
MIME type is `application/vnd.storiiboard.project`.

## Safety while a project is open (1.2)

Sync services (iCloud Drive, Dropbox, Google Drive, OneDrive) don't carry SQLite's locks between computers and can't
merge a database, so two guards sit around every open project:

- **The check before every write.** After each of its own writes, the app records the file's size and modified time,
  plus its device and inode on Mac and Linux. Before the next write or backup it compares them. If they differ, a
  sync has replaced or rewritten the file: the write is refused ("The project file changed on disk since Storiiboard
  last saved it."), nothing is written, and the app reopens the newer version and says the last change wasn't saved.
  Windows has no stable file id in Rust's std, and sync services there can't rename over a file SQLite has open, so
  size and time cover it.
- **The lock file** (below). Opening a project whose lock is fresh and from another computer asks first: Open a copy,
  Open anyway or Cancel. A lock from this same computer (one left by a crash) or one not refreshed for 5 minutes is
  ignored. It's advice: Open anyway takes it over.

## Files next to a project

| File | What it is | From | Kept |
|---|---|---|---|
| `<Project>.sbd` | The project | 0.4 | |
| `Backups/<Project> YYYY-MM-DD HH-mm.sbd` | Automatic full copies | 0.4 | 12 plus one a day for 14 days |
| `<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm` | Copy made before a migration | 0.4 | Never pruned |
| `<Project> YYYY-MM-DD HH-mm (from backup).sbd` | A backup opened with Open backup: a separate project, copied out of `Backups/` with VACUUM INTO. A second copy of the same backup is `(from backup 2)` | 0.7 | Like any project |
| `.<Project>.sbd.lock` | While the project is open: which computer has it open. JSON: `app`, `computer` (its name), `machine` (a random id per install), `session`, `opened_at` and `refreshed_at` (ms since the epoch). Hidden: a leading dot on Mac, the hidden attribute on Windows | 1.2 | Deleted on close; rewritten every minute while open; stale after 5 minutes |
| `<Project> (copy).sbd` | Open a copy, chosen when another computer has the project open. A separate project | 1.2 | Like any project |
| `<name>.sbdchanges` | Suggestions from the web review copy | Phase 7 (import), Phase 9 (web) | Wherever the person saved it |
| `<name>.sbdpack` | Zip of the .sbd and every linked file (Collect Project) | Phase 8 | |
| Review package | Compressed review copy: the records reviewers may see, compressed images, theme and watermark. Uploaded on Publish, or exported as a file | Phase 9 | On the web, 30 days after the last shoot day |

## Planned changes

### Schema 3: media (Phase 1, project themes)

The project's logo or key image is the first image the file stores, so the media and thumbnail tables arrive with
project themes. The tables are designed in that milestone, with Kevin's approval. The migration also writes the default
theme into projects that have none.

### Schema 4: named versions (Phase 1, History)

A named version is a named point in History, not a copy. Open version copies the project, restores the copy to that
point, and opens the copy as a separate project, as Open backup does.

`versions`

| Column | Type | Notes |
|---|---|---|
| name | text | "Board sent to client" |
| note | text, null | |
| op_group_id | text | The last op group included (op_groups.id) |
| created_by | text | |

Versions are kept until someone deletes them.

### Schema 5: notification read state (Phase 3)

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
| 1 | 0.4 | First schema: meta, records (with `trashed_at` and `trashed_by`), ops |
| 2 | 0.5b | Append-only History: `op_groups`; `ops.state` and `meta.undo_cursor` removed. Each v1 `undone` or `discarded` mark becomes an `undo` group where that undo must have happened, and `ops.seq` is renumbered to follow the groups |
| 3 | Phase 1 (planned) | Media and thumbnails, for the project's logo; default theme written into older projects |
| 4 | Phase 1 (planned) | Named versions: `versions` |
| 5 | Phase 3 (planned) | Notification read state: `notification_cursors`, `notification_reads` |

Project props (`state`, `theme`, `watermark`) and suggestion records need no table change, so they have no schema
number.
