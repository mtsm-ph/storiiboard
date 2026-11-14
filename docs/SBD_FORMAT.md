# The .sbd file format

**Status:** schema v8 (Phase 2); sections marked planned aren't built yet. Every
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

Keys: `schema_version` (2); `app_version`, the app that last opened the file; and `file_id` (from 1.4), a UUID written
the first time a file opens, which keys a synced project's local backup folder. v1 files written by 0.5 also had
`undo_cursor`; schema 2 removes it, since the undo position now lives in op_groups.

### records

| Column | Type | Notes |
|---|---|---|
| type | text | One of the record types in CLAUDE.md, such as `scene`, `shot` or `media` |
| parent_id | text, null for the project | The parent record. A foreign key checked at commit, so one op group can create a parent and its children in any order |
| sort_key | text | Fractional key that orders siblings, so a reorder rewrites one row instead of the parent |
| props | JSON | The record's properties, custom ones included. Changing `type` keeps every prop |
| trashed_at | text, null while live | When the record went to the Trash (see Trash) |
| trashed_by | text, null while live | Who sent it there: the op's author (see `ops.author`) |

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
| kind | text | `create`, `update` (props patch), `move` (parent and sort key), `retype` (keeps every prop), `trash`, `restore` (from the Trash), `revert` (set back by a restore group), or `purge` (deleted for good by Empty Trash, 1.21; `before` and `after` null). An undo or redo group's ops keep the kind of the op they reverse or replay |
| before, after | JSON | The whole record either side of the op, as its row with `props` as an object: `id`, `type`, `parent_id`, `sort_key`, `props`, `trashed_at`, `trashed_by`, `created_at`, `updated_at`. Null where there's no record on that side (before a create) |
| author | text | Who made it, as their profile on that computer named them: their name, or their initials if they chose that or gave no name (Settings → Profile). `local` means no name (a person named exactly "local" reads the same): every edit before names were kept (Nov 5), and any made with an empty profile. Free text, never an id: two people can share a name, and a renamed person's older edits keep the old one |
| timestamp | text | When the edit happened |

Indexes: `ops_by_group (group_id)` for undo, and `ops_by_record (record_id, seq)` for an item's history.

### op_groups (schema 2)

One row per op group: one user action, or one undo, redo or restore.

| Column | Type | Notes |
|---|---|---|
| seq | integer, unique | Order of the groups |
| kind | text | `edit`, `undo`, `redo`, `restore` or `empty_trash` (1.21) |
| target_group_id | text, null | For `undo` and `redo`: the group undone or redone |
| restore_to | text, null | For `restore`: the group whose end state the project went back to; null for the project as created |
| stack_below | text, null | On `edit` and `restore`: the group ⌘Z takes once this one is undone. On `undo`: the group ⌘⇧Z takes once the undone group is redone. Null on `redo` |
| undo_top, redo_top | text, null | The next group ⌘Z and ⌘⇧Z would take, as of the end of this group. Null when that stack is empty |
| author | text | Who made it, as their profile on that computer named them: their name, or their initials if they chose that or gave no name (Settings → Profile). `local` means no name (a person named exactly "local" reads the same): every edit before names were kept (Nov 5), and any made with an empty profile. Free text, never an id: two people can share a name, and a renamed person's older edits keep the old one |
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
image back, until the person deletes it: Empty Trash removes trashed records' data from it, and Clean up old pictures
deletes the bytes of pictures only History uses (1.21: no record shows them, live or in the Trash, and no step on the
undo stack had them), never one a named version shows (1.23); the steps stay, and a frame they name such a picture on
reads "Picture missing". Deleted rows are overwritten with zeros (`secure_delete`, on every connection from 1.21 on), so what's deleted
is gone from the file itself, though the file doesn't shrink: SQLite reuses the space for new pictures. Space freed
before 1.21 wasn't zeroed, so a file edited with an earlier build can still hold older versions of some text in its
free space.

## Schema v3: pictures (1.10)

Pictures are stored in the file as bytes, addressed by their SHA-256, so a picture used in three frames is stored once
and a stored picture never changes. A `media` record points at the bytes, and a frame points at its media record
(1.11). The bytes sit in their own tables, apart from the records, so the History, which keeps whole records before
and after each edit, never copies a picture.

`media_files`: one row per stored picture.

| Column | Type | Notes |
|---|---|---|
| sha256 | text, unique | Hex SHA-256 of `bytes`: the picture's address |
| mime | text | `image/jpeg`, or `image/png` for a picture with see-through pixels |
| width, height | integer | Pixels, upright |
| byte_size | integer | Length of `bytes`, so totals don't read the pictures |
| color_space | text | `display-p3` or `srgb`: the profile embedded in `bytes` |
| bytes | blob | The stored picture: at most 2560px on the long edge, EXIF orientation applied |

`thumbnails`: the smaller copies the board draws.

| Column | Type | Notes |
|---|---|---|
| sha256 | text | The picture's address (media_files.sha256) |
| long_edge | integer | 640. Unique with `sha256`, so other sizes can be added without a schema change |
| mime, width, height | | As in media_files |
| bytes | blob | |

- `bytes` is the last column in both tables. SQLite reaches a column after a blob only by reading the blob's overflow
  pages, so a picture's size or type would otherwise cost reading the whole picture.
- Colour: pictures are stored with the Display P3 profile. P3 photos, which every recent iPhone takes, keep their full
  colour; sRGB pictures lose nothing, since sRGB fits inside P3; other profiles, such as Adobe RGB, are converted. An
  engine that can't draw in P3 stores sRGB, and `color_space` says which.
- A picture's bytes are written in the same transaction as the op that first uses them, so a crash never leaves a
  record pointing at nothing. Only the person deleting them on purpose can (below).
- Bytes stay when the record using them is undone, trashed or given another picture, so undo, a History restore or a
  named version can bring an old picture back. They're deleted only by Empty Trash (bytes nothing left in the file
  refers to) and Clean up old pictures (bytes only History refers to, and no named version shows), both after a
  confirm (1.21). A frame or step that then names a deleted picture shows "Picture missing".
- The original file isn't copied in. The media record keeps its path as a pointer, so a later full-resolution export
  can use it if it's still there.

`media` record props, for a picture:

| Prop | Value | Notes |
|---|---|---|
| kind | `image` | `video` from schema 8 (below) |
| file | text | media_files.sha256 |
| mime, width, height, color_space | | As in media_files, so a view can lay out a frame without reading that table |
| source_name | text | The file's name, when the picture came from a file: `IMG_4012.JPG` |
| source_path | text | Where the original was: relative to the .sbd's folder when inside it (`refs/IMG_4012.JPG`, always with `/`), absolute otherwise. A pointer only; missing for a pasted picture |

Schema 3 also adds three record types: `note` (a note card on the board, 1.12), `character` (from script import, 1.17)
and `stroke` (one sketch stroke under its shot, 1.13). They need no table, but they come with the schema number: an
older app refuses a file at schema 3 ("Update Storiiboard"), so it never meets a record type it doesn't know.

## Schema v4: named versions (1.23)

A named version is a named point in History, not a copy (src/core/storage/versions.ts). Open version copies the
project, gives the copy a `file_id` of its own, restores the copy to that point (a `restore` group in the copy), and
opens it as a separate project, as Open backup does. The original is never changed.

`versions`

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| name | text | "Board sent to client"; up to 80 characters |
| note | text, null | |
| op_group_id | text | The last op group included (op_groups.id). Index `versions_by_group` |
| created_by | text | Who named it, as `ops.author` says who made an edit |

Versions are kept until someone deletes one (after a confirm). Naming, renaming and deleting a version aren't edits to
the project, so they're not in History and undo leaves them alone. Empty Trash leaves versions, though a version
opened later lacks what it deleted. Clean up old pictures keeps every picture a version's step shows (read as a
restore to it reads it: for each record changed since, the `before` of its first op after the step), until the version
is deleted.

How Open version makes its copy (src/app/openVersion.ts), so the original is never touched and a copy that fails
partway never looks finished:

1. A consistent copy of the open project is written through its own connection with VACUUM INTO, after the same
   on-disk check as a write, to a hidden draft beside it: `.<Project> (<version>) <8 hex digits>.sbd`.
2. The draft is opened on a connection of its own, given its `file_id` and restored to the version's step, then
   closed.
3. It's renamed to `<Project> (<version>).sbd` (`(<version> 2)` when that's taken; nothing is overwritten), and opened.
   A failure before the rename deletes the draft. Only drafts the app made this session can be renamed or deleted this
   way (src-tauri/src/sbd.rs).

The version's name in the file name loses what a file name can't hold (`/ \ : * ? " < > |`), and is shortened so the
file name, its journal and its lock file stay within 255 bytes, and on Windows the path and its journal's within
SQLite's 259 characters. The names of the backups the copy will need fit too, as they're written (`.partial` until
complete): a scheduled backup in `Backups/` beside it, and the copy made before a schema upgrade (room is left for a
two-digit schema), without which the upgrade refuses to run. A synced project's backups go to a folder on this
computer; their names fit, but that folder's path isn't checked.

## Schema v5: slate numbers (1.26)

A locked scene remembers every shot number it has given out (Kevin, Nov 4), so a number that has been on a slate is
never given out again, even after Empty Trash deletes the frame that had it (src/core/storage/slateNumbers.ts; the
rules in src/features/storyboard/board.ts).

`slate_numbers`

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| scene_id | text | The scene that gave the number out. No reference to records: a scene Empty Trash deletes keeps its rows |
| number | text | The shot number as on the slate: `4C`. Unique with scene_id |
| shot_id | text | The shot it was slated with. No reference either: the shot may be gone for good |

- Only numbers given out while the scene is locked are kept. An unlocked scene's letters follow the board and close up,
  so boarding never leaves gaps. Locking a scene records the numbers its frames have then, and every number a frame
  gets there afterwards. Only live frames are recorded: a frame trashed while the scene was locked was recorded while
  it was live. One in the Trash that wasn't slated gives its letter up as the scene is locked (the Trash lists it as
  an unnumbered frame) and takes the next free one when it's restored, so boarding unlocked leaves no gaps.
- Every op group writes its rows in its own transaction, after its records: a frame added to a locked scene, a scene
  as it's locked, and anything undo, redo or a History restore writes. Nothing ever deletes or changes a row: not undo,
  not a restore, not Empty Trash. They're kept apart from the records for that reason: History stores whole records,
  so a list in a scene's props would go back with any undo of an older change to the scene.
- A locked scene's next free letter comes after the highest it has used (its frames, live or in the Trash, and its
  rows here), and skips every number a live frame on the board holds and every row, so 4C, made in a scene since
  renumbered 9 or deleted for good, is never made again in a locked scene 4. Frames in other scenes' Trash don't
  count: one slated has its row, and one never slated is numbered afresh when it's restored.
- Locking is when numbers go onto slates, so then no number may be on two:
  - a frame slated in this scene before (locked, unlocked and edited, locked again) takes back the number it had;
  - any other live frame keeps its number unless another shot was slated with it or a live frame elsewhere holds it
    (a new scene 4 boarded unlocked after the old one was deleted reads 4A, 4B again, which are on footage);
  - if any live frame needs a new letter, every live frame not slated before takes one, in board order after the
    scene's highest, so the board still reads in order; a frame in the Trash that clashes loses its number and takes
    one when it's restored. A lock that keeps every number writes only the lock. Undo takes the lock back with its new
    numbers.
  - A lock that re-letters frames says which, once it's saved: "Locked SC 04. To keep slate numbers unique, 4C is now
    4E." (Kevin, Nov 4, 1.28).
  - A frame in the Trash that gave its letter up takes the next free one when restored (approved, Nov 4).
- A frame restored from the Trash into a locked scene keeps its number only while no live frame holds it and no other
  shot was slated with it; otherwise it takes the next free letter. A frame moved back into a locked scene it was
  slated in takes back the number it had there, while it's free. A locked scene restored under a new number (its own was taken
  meanwhile) numbers its frames afresh in board order, skipping the same numbers, and stays locked.
- The migration replays the log, an op group at a time, to find every number a live shot had at the end of a group
  while its scene was locked, whether that shot is live now, in the Trash or only in History (made and then undone),
  with the shot it was slated with: where a v4 locked scene gave one number to two shots, the one of those holding it
  now, else the first. Frames a v4 lock left in the Trash with an unlocked board's number aren't counted, and neither
  is a frame that took a number only while the scene was unlocked.
  Frames an Empty Trash deleted before schema 5 can't be found, since it cleared their steps, and neither can which
  scene they were in or whether it was locked (a locked scene deleted whole leaves no lock behind). So after any
  Empty Trash before schema 5, `meta` gets `slate_numbers_unknown` = `true`, and the Empty Trash confirm says, while
  any scene is locked, that a locked scene could give one of those numbers out again.
- They're part of the file, so backups and Open version copies carry them. The JSON export (Phase 2) must carry them
  too.

## Schema v6: department status (polish 6)

Approved by Kevin, Nov 5. A shot kept `departments`, the departments it needed as on/off tags. Every department is
involved in every shot, so a shot now keeps how far each one has got with it: `department_status` (Storyboard props,
below; src/core/model/departmentStatus.ts). No table changes.

- The migration turns each department that was on into Priority (`{ "camera": { "priority": true } }`), each id once,
  text ids only, and takes `departments` off. Only shots: no other record ever had it. migrate() backs the file up
  first, as before every migration.
- The edit log is append-only and keeps the old lists. A point restored from before v6 (Restore to here, Open
  version) has `departments` again, and the app reads it as Priority; the next status edit on that shot takes the
  list off.
- Seen (automatic, when someone from a department opens a shot) is schema 7, below, and isn't an op.

## Schema v7: Seen (polish 6b)

Part of the department status Kevin approved Nov 5. Opening a frame marks it seen by the departments the person's
role on the project stands for (src/core/model/departmentStatus.ts, ROLE_DEPARTMENTS; src/core/storage/seen.ts).

`shot_seen`

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| shot_id | text | The frame. No reference to records, like `slate_numbers` |
| department | text | A department id |
| seen_at | text | The first time; a later opening writes nothing |

- Unique on (`shot_id`, `department`).
- Seen is automatic, like a notification read: not an op, so undo, redo and Restore to here never touch it and
  History doesn't list it. A frame in the Trash keeps its rows; Empty Trash deletes them with the frame.
- One row per department, not per person, until the web brings people (Phase 9: Seen per team member).
- It's part of the file, so backups and Open version copies carry it.
- A first opening writes to the file, so a session of only looking can count as a change for the 5-minute backups
  (and a synced folder uploads it). It's bounded: once per frame and department, ever.

## Schema v13: approvals kept through the upgrade (3.18)

Changes existing data (Kevin Nov 9: "An approval that was current before an upgrade stays current after it"); no
table change. 3.6b's approval rule reads a scene's props, its `characters` among them, so schema 12 as first built
left an approval given before it reading "Changed since approval" on a scene whose names it turned into ids. Schema 12
now re-stamps them itself (below); schema 13 repairs files upgraded before it did.

- For each scene with `department_approvals`, schema 12's own step in History is the newest `update` op on it whose
  `before` holds a `characters` list and whose `after` holds no name there and differs in nothing else but
  `character_ids` (a list it emptied, `[]` or blank names only, came off with no ids written).
- When the scene's `character_ids` and `characters` are still what that step wrote, the scene is read as it is now
  with the step's `before` characters back. Each sign-off current then and not now gets `basis` re-stamped by the rule
  it was made with, on the scene as it is now. A sign-off changed for another reason, or on a scene whose characters
  were edited since, stays as it is.
- The changes are one logged `edit` step in History, and the undo and redo stacks end there, as schemas 9 and 12's
  do; a file with nothing to repair gets no step. The file is backed up first.
- A Restore to a point between schema 12's step and schema 13's, or Open version of a version named there, brings
  back the approvals as they were then, before the repair, and no migration runs again: approving again clears them.
- Any later migration that rewrites what an approval rule reads does the same: every sign-off current just before it
  is re-stamped by its own rule on the records after it (src/core/model/sceneApprovals.ts, `approvalsKeptThrough`).

## Schema v12: scene characters as ids (3.13)

Changes existing data (approved by Kevin Nov 9); no table change. A scene's speaking characters were names
(`characters`, as a script import spelled them); now they're `character_ids`, the ids of the project's `character`
records, in the script's order, so a rename in Cast and crew is a rename everywhere and a call sheet can read who's in
a scene and who plays them.

- Each name is matched to a live `character` of the scene's project, trimmed and in any case ("MARY " is Mary); the
  first by sort key when two share a name. A name with no match gets a new `character` (its name trimmed, after every
  other character, in the Trash too). One in the Trash isn't matched: a new one is made beside it.
- A name listed twice is one id; an empty one is dropped. A value in `characters` that isn't text stays in
  `characters`; otherwise `characters` comes off. A scene with no names left has no `character_ids`.
- Scenes in the Trash are changed too, so a restore brings their characters back.
- The changes, new characters included, are one logged `edit` step in History (`create` ops for the characters,
  `update` ops for the scenes), and the undo and redo stacks end there, as schema 9's do. The file is backed up first.
- From here a script import writes `character_ids` too. A character in the Trash, or gone for good, reads as none.
- A scene's sign-offs current before the upgrade are re-stamped by their own rule on the scene after it (3.18), in
  the same step, so none reads "Changed since approval" because of it.
- Restore to here, or Open version, from before the upgrade puts scenes back with `characters` names (the characters
  it made go with it), and nothing converts them again. A scene without `character_ids` reads its `characters` as the
  upgrade matched them: the project's live characters by name, trimmed and in any case, the first by sort key.

## Schema v11: cached lookups (3.4)

Additive (approved Nov 9). Every lookup the app makes on the network is kept in the project with when it was fetched
(CLAUDE.md, Network rules), so a search pressed twice asks once and its answer is there offline
(src/core/storage/lookups.ts).

`lookups`

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| kind | text | `address_search` (3.4), `weather` (4.4) or `hospital_search` (4.5). No schema change: the column takes any kind |
| query_key | text | What was asked, as the lookup keys it. For `address_search`: the language and the words, in one case and spacing (`en\|plaza de armas, cusco`), since Nominatim names places in the language asked |
| query | text | The words as asked. For `weather`: the same as `query_key` |
| result | text | The answer as JSON. For `address_search`: a list of `{ "name", "latitude", "longitude" }`, at most five, in the service's order. For `hospital_search`: a list of `{ "name", "address", "latitude", "longitude", "distanceKm", "emergency", "phone", "countryCode" }`, at most five, emergency department first, then nearest (its `query_key` is the language and the place to 3 decimals, `en|-13.517,-71.979`). For `weather`: `{ "expires", "last_modified", "forecast": [...] }` (below) |
| fetched_at | text | When the answer came from the network (ISO 8601) |

- Unique on (`kind`, `query_key`): asking again (Search again) replaces the row.

`weather` (4.4)

- `query_key`: the place's `latitude,longitude` rounded to 4 decimals with all four shown (`-13.5168,-71.9788`), as MET
  Norway's terms ask coordinates to be cut.
- `result`: MET Norway's Locationforecast reduced in Rust (src-tauri/src/weather.rs), in MET's own metric values:
  `expires` (ISO 8601 UTC: the answer's `Expires`, counted from its `Date` header when it has one so a wrong local
  clock doesn't matter, else one hour after it was fetched), `last_modified` (ISO or null; sent back as
  `If-Modified-Since` when an expired forecast is renewed, and a 304 keeps the entries and takes the new `expires`), and
  `forecast`, a list in time order of `{ "time" (UTC, as 2026-11-17T12:00:00Z), "temperature" (°C or null), "wind" (m/s or
  null), "rain1h" and "rain6h" (mm over the hour and over the six hours after `time`, or null), "symbol1h" and
  "symbol6h" (MET symbol codes such as lightrain or partlycloudy_day, or null) }`. An entry covers the time up to the
  next one, by the span that fits; the page prorates each span to the day in the location's time zone.
- `fetched_at` is when the answer came from the network. The app asks again for the place only once `expires` has
  passed; a day's weather is worked out from the entries in the location's time zone, and units are converted for
  display only. The forecast is never part of the `callsheet` record (4.7's "Changed since issued" ignores it).
- Not an op: a cache isn't a step in History and isn't undone. Writing one counts as a change for the 5-minute backups.
- Read back, every answer is checked again; one that can't be read counts as none, and the app asks the network.
- A JSON export carries the table, and an import brings it back.

## Schema v10: notification read state (3.10)

Additive (approved Nov 7 and 9). The notification feed isn't stored: like every rollup, it's worked out from History's
steps (later, suggestions and comments too). What's stored is each person's read state, in two tables
(src/core/storage/notifications.ts).

`notification_cursors`

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| user_id | text, unique | The person picked with This is me in Cast and crew, else `local` (until sign-in, Phase 9) |
| read_through_seq | integer | Every step at or before this place in the log (`op_groups.seq`) counts as read: Mark all read. A place, never a time, so another computer's clock can't hide a step or read one early; it only moves forward |

`notification_reads`

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| user_id | text | As above |
| item_kind | text | `op_group` now; `suggestion` and `comment` with Phases 7 and 9 |
| item_id | text | The op group's id, or the suggestion's or comment's record id |
| read_at | text | When it was opened |

- `notification_reads` is unique on (`user_id`, `item_kind`, `item_id`); a second opening keeps the first time. When a
  person's cursor moves, their rows for steps at or before it are deleted.
- Writing read state counts as a change for the 5-minute backups, as Seen does; a step already read, or yours, writes
  nothing when opened.
- Read state isn't an op: marking an item read can't be undone and isn't a step in History.
- A step by the person reading (its `author` is who they sign as) counts as read: they made it. By name, until sign-in
  brings a stable id: steps signed before a rename read as another's, and two people with no name (both `local`), or
  with the same initials, read as one.
- A JSON export carries the read state, and an import brings it with it.
- Web users' read state will live in Supabase (Phase 9), because the web never edits the .sbd.

## Schema v9: approvals per scene (3.6b)

Approved by Kevin Nov 9; it alters existing data. The director or the DP approves each department once per scene,
in the scene's `department_approvals` prop (Storyboard props, below; src/core/model/sceneApprovals.ts); a shot's
`department_status` keeps Priority, Working on it and Done. No table changes.

- A scene is approved for a department, by an approver (the director, the DP), only if every frame in it was
  approved for that department by that approver. The scene's approval takes the name and time of the latest of those,
  merged into one approval with both roles when one person was both, and a `basis` worked out from the scene as it is,
  so it starts current. Otherwise the scene isn't approved for it. A scene's frames are its live ones; for a scene in
  the Trash, also those that went to the Trash with it. A scene without frames gets nothing.
- Then every shot's `department_status` loses its `approvals`, in the Trash or not; an entry left with nothing comes
  off, and anything else in it stays. Department ids this version doesn't know are carried the same way; an approval
  with neither a director nor a DP among its roles was never one of these, and stays on its shot.
- migrate() backs the file up first, as before every migration. The changes are logged: one `edit` group by `local`,
  with an `update` op per record changed (whole records before and after, `updated_at` set to the upgrade's time), so
  History lists what moved and what came off. Its `stack_below`, `undo_top` and `redo_top` are null, as an
  `empty_trash` group's are, so the undo and redo stacks end there: ⌘Z after the upgrade never writes back an older
  step's record, a scene without its approvals or a frame with its own. Restore to here can still go to a point before
  it, as a choice that undo takes back; that point has the frames' approvals, kept as stored and shown only in
  History's words, and none on its scenes.

## Schema v8: video (Phase 2)

Approved by Kevin Nov 5. Videos stay outside the .sbd (CLAUDE.md): a `media` record of kind `video` points at the
original and keeps what ffprobe read from it (src/core/media/video.ts). A frame plays part of a video through its
`clip` prop; a picture grabbed from a video says where it came from in `from_video`. Those are props and need no
table, but the schema number rises with them, so an older Storiiboard refuses the file ("Update Storiiboard") rather
than show its frames without their clips. The one new table holds LUTs (2.5).

`media` record props, for a video (a child of the project, so two frames can play parts of one video):

| Prop | Value | Notes |
|---|---|---|
| kind | `video` | |
| source_name | text | The clip's file name, as editors and camera reports call it: `A001_C003_0101AB.MP4` |
| source_path | text | As for a picture: relative to the .sbd's folder when inside it (always with `/`), absolute otherwise. Missing only in the browser build |
| source_size | integer | Bytes, when known: tells the same clip from another with its name when relinking |
| duration_frames | integer | Frames at `fps` |
| fps | `{ num, den }` | The exact rate: `{ "num": 24000, "den": 1001 }`, never 23.976. A variable-rate phone clip has the nearest camera rate, which its playback copy is made at, and `duration_frames` is its length at that rate |
| start_timecode | text | As the source writes it: `01:00:00:00`, or `01:00:00;00` for drop-frame; missing when it has none |
| width, height | integer | Stored pixels, before rotation |
| sar | `{ num, den }` | Pixel shape: `{1,1}` square; `{4,3}` for HDV's 1440x1080; `{2,1}` for a 2x anamorphic |
| rotation | 0, 90, 180, 270 | Degrees clockwise to show it upright (a phone held upright: 90) |
| codec | text | ffprobe's name: `h264`, `hevc`, `prores` |
| has_audio, hdr | boolean | HDR is PQ or HLG; shown as SDR once tone-mapped (2.3) |
| bit_depth | integer | 8, 10, 12 |
| poster | text | The id of an image `media` record under the video: a still shown for it where there's no frame yet; optional. A record, not a hash, so Empty Trash and Clean up old pictures count its picture as used like any other |
| lut | text | A `luts` id (2.5); missing for none |

- Frames are counted from 0 at the video's own rate. Timecode is worked out from `start_timecode` and a frame number
  (src/core/media/timecode.ts), never stored per frame, except in `from_video`, where it records what the slate said.
- Relink sets the file's props from the new file and takes off the ones it lacks (`source_path`, `source_size`,
  `start_timecode`); `poster` and `lut` stay, and so do the frames that play the video. One op, so undo puts the old
  file back.
- The page reads a video's file only through Rust (src-tauri/src/video.rs), never for writing, and only one the
  person dropped or chose this session; one they handed over before, which Rust remembers in this computer's app data
  (`known-videos.json`, which only Rust writes); or one inside the open project's own folder that a live video record
  links (relative path, no `..`, no symbolic link or junction anywhere below the project's folder), as when a
  project folder is copied with its footage. Rust decides from the path and the records before it asks the disk. A path a
  project file names elsewhere, a network share among them, is never read until the person relinks it, so a project
  someone sends can't make the app reach for a file or a server.

`clip`, a shot prop: the part of a video the frame plays (2.8).

| Field | Value | Notes |
|---|---|---|
| video_id | text | The video's media record |
| in_frame, out_frame | integer | Both included, at the video's `fps`; `out_frame` ≥ `in_frame` |
| crop | `{ x, y, zoom }` | How the clip sits in the frame (2.6), the frame-picture crop of 1.11; missing when centred |

`from_video`, a prop of a picture's media record: where a still came from (2.7), enough to grab the same frame again
after the video is relinked or its LUT changes.

| Field | Value | Notes |
|---|---|---|
| video_id | text | The video's media record |
| frame | integer | At `fps`, counted from the video stream's first frame (not the file's start, which sound can lead) |
| fps | `{ num, den }` | The video's rate when it was grabbed |
| timecode | text | The frame's source timecode, as on the slate and in the edit |
| source_name | text | The clip's file name when it was grabbed |
| lut_id, lut_name | text or null | The LUT it was graded with, and its name then |

`luts`: LUTs loaded for videos (2.5). Content-addressed like pictures: the same `.cube` loaded twice is stored once,
and a row is never changed after it's written. A video names its LUT by id, so a LUT change is an op like any other.
The row is written in the same transaction as the op that first names it; an undo leaves it stored (rows are small,
and a redo needs it). Only 3D LUTs are stored (`LUT_3D_SIZE` 2 to 256); the app checks a file before it stores it.

| Column | Type | Notes |
|---|---|---|
| id, created_at, updated_at | | As every table |
| sha256 | text, unique | Hex SHA-256 of `cube` |
| name | text | Shown in the app: the file name without `.cube` |
| file_name | text | As loaded: `SLog3SGamut3.CineToLC-709.cube` |
| byte_size | integer | Length of `cube`, so totals don't read it |
| cube | text | The `.cube` file's text, last for the same reason as `bytes` in media_files |

## Location props (3.3)

A `location` record (under the project) is one place the project shoots, named once and linked from its scenes'
`location_id`. Props: `name`; `status` (`tbd`, `confirmed`, `cancelled`; missing or odd reads as `tbd`); `address`,
`contact_name`, `contact_phone`, `contact_email`, `parking`, `power`, `notes` (text). The contact's phone and email are
private: shown in the app, never logged. No table change.

3.3b, also no table change:
- Photos are `media` records (kind `image`, as a frame's pictures) whose parent is the location, ordered by sort key;
  their bytes are in `media_files` and `thumbnails` as any picture's.
- `custom` on a location: its own fields, an object of name to text, as a shot's `custom`.
- `location_id` on a shot: where that frame is shot when it isn't its scene's location. Missing means the scene's.
  A location in the Trash reads as none, for the shot as for the scene.

3.4, also no table change: a place picked from the address search puts `latitude` and `longitude` (numbers, degrees,
WGS 84) and `map_name` (the place's name as the map service wrote it) on the location, together, in one op. All three or
none count: a latitude outside ±90, a longitude outside ±180, or a missing name reads as no place. `address` stays as
typed (an empty one takes `map_name`). Like the address, they're private in History: named, never shown.

4.9, also no table change (additive, like `full_view`; an older version keeps it as it is): `map_moved` on a location is
`true` when the pin on its map was dragged, or moved from the keyboard, to where the crew should go (an entrance, a
basecamp), so the sheet can say "Pin placed by hand". The move sets `latitude`, `longitude` and `map_moved` in one op and
leaves `map_name`. Missing, or anything but `true`, reads as not moved. A new address, a new pick from the address search
and Clear place all take it off with the place. The map's tiles are not in the file: they are kept on the computer, in its
cache folder.

4.3, also no table change (additive, like `full_view`): `time_zone` on a location is an IANA zone id (`America/New_York`)
chosen by hand. Missing, empty or a name the reader doesn't know reads as unset, and the call sheet then uses the zone
looked up offline from the place on the map (`latitude`, `longitude`), else the reading computer's. A new address that
takes the place off the map leaves `time_zone` as it is.

4.5, also no table change (additive, like `full_view`; an older version keeps these props as they are and prints no safety
box): `country_code` is the location's country, ISO 3166-1 alpha-2 in upper case (`PE`); missing or anything else reads as
not set. The call sheet prints the emergency number for it from a table in the code (src/core/model/emergencyNumbers.ts),
or "check locally" for a country not in it. The nearest hospital is kept as `hospital_name`, `hospital_address`,
`hospital_phone` (text), `hospital_latitude` and `hospital_longitude` (numbers, degrees, where it is; a hospital typed by
hand has none), `hospital_emergency` (`true` when OpenStreetMap says it has an emergency department; missing means
unknown, never "none") and `hospital_source` (`osm` when it was picked from the OpenStreetMap search, which the call sheet
then credits; missing for one typed by hand). A hospital exists while any of `hospital_name`, `hospital_address` or `hospital_phone` is set. Typing by hand over a picked hospital takes `hospital_emergency` and the coordinates off with a new name, and the coordinates off with a new address (the call sheet then says to check the emergency room, and gives no distance); `hospital_source` stays `osm` through hand edits until Clear or a new pick. Picking one sets them
in one op, and sets `country_code` too when the location has none; Clear hospital unsets all seven props in one op. The
hospital's address, phone and coordinates are private in History: named, never shown.

## Shoot day props (3.7)

A `shoot_day` record (under the project) is one day of the shoot. Props: `date` (`YYYY-MM-DD`, a real calendar date;
missing or odd reads as none), `call_time` and `wrap_time` (`HH:MM` on a 24-hour clock), `notes` (text). Its number
("Day 3") is worked out from the live days' dates (undated last, then sort order), never stored, so changing a date
renumbers the days. Additive (approved Nov 7 and 9): props on a record type every version has, so no schema number; an
older version keeps them as they are.

- `shoot_day_id` on a `shot`: the day it's shot. A frame is in at most one day. A day in the Trash, or gone for good,
  reads as none: its frames are unscheduled until it's restored. Only "Need to shoot" frames are offered for a day.
- `setup_minutes` on the `project`: the minutes per setup a day's estimate counts (1 to 600; missing means 30).
- `hmu_minutes` on the `project` (4.8): the least minutes HMU needs between a cast member's call and their HMU ready time, for the call sheet's
  "HMU too short" check (0 to 600; missing or odd means 45). Additive: no schema number; an older version ignores it.
- `crew` on a `shoot_day` (3.8): who has confirmed the day, `{ "<person id>": "confirmed" }`; anyone not there is
  pending. Other values and ids this version doesn't know are kept as they are. Who is called is `people_ids` (4.2,
  below).
- `people_ids` on a `shoot_day` (4.2): who is on the day, a list of person ids, in the order added, each once. A day
  without the prop (every day made before 4.2) reads as everyone live in Cast and crew; a day made from 4.2 on starts
  with `[]`, nobody. Ids of people in the Trash or gone are kept as they are and skipped when read, so a restore brings
  them back; taking someone off keeps their `crew` entry and their times. A value that isn't a list of text reads as
  the prop missing and is never written over. Additive (no schema number): an older version ignores it and treats
  everyone as called.
- A day's totals are worked out, never stored: its live "Need to shoot" frames in live scenes; their setups (frames in
  the same setup count once, a frame in none is a setup of its own, as Setups below reads `setup_id`); and setups times
  the minutes per setup. Two days may share a date.

## Setups (6.0)

A `setup` record (under its `scene`) is one camera position and lighting state; several frames can share one.
Additive: a prop on a record type every version has, and the existing `setup_id`, so no schema
number.

- `name` on a `setup`: typed by hand, '' for none ("Setup 2 · Window side").
- Its number ("Setup 2") is its place among the scene's live setups in the scene's order of children, worked out,
  never stored: reordering or trashing one renumbers the rest. Never lettered (shot numbers use the letters).
- `setup_id` on a `shot`: the setup the frame is in, at most one. An id naming a setup in the Trash, a setup in another
  scene, or nothing reads as no setup: the frame is a setup of its own. Every reader (Shoot days included) reads it so.
- Moving a frame to another scene unsets its `setup_id` in the same op group.
- Trashing a scene takes its setups with it; restoring it brings them back.
- A trashed setup's frames keep their `setup_id`, so restoring the setup brings them back into it without touching
  them.

## Attachments (3.11)

A PDF or a link on the project, a scene, a shot, a location or a person is a `media` record under it, as a frame's
picture is. Additive (approved Nov 7 and 9): no schema number.

- `kind: "pdf"`: `file` (the bytes' SHA-256, in `media_files` with `mime` `application/pdf`, `width` and `height` 0,
  `color_space` ''), `source_name` (its file name), `byte_size`. At most 50 MB. Empty Trash and Clean up delete its
  bytes when nothing refers to them any more, as a picture's.
- `kind: "link"`: `url` (http or https), `title` ('' for none).
- A location's photos are its other `media` records; attachments aren't among them.

## Gear props (3.9a)

A `gear_item` record (under the project) is one item in the project's gear catalogue: a package, a lens set, a
light. Props: `name`; `department` (a department id; missing or odd reads as none); `quantity` (a whole number, 1 to
999; missing or odd reads as 1); `source` (`owned` or `rental`; anything else reads as owned); `owner` (who owns it,
or the rental house); `day_rate` (a number to the cent, in the project's currency; missing means no rate); `notes`.
`currency` on the `project`: a three-letter ISO 4217 code (missing or odd reads as `USD`). Additive (approved Nov 7
and 9): props on record types every version has, so no schema number.

`gear_ids` (3.9b) on a `shot` (the gear it needs) and on a `shoot_day` (the day's gear list): `gear_item` ids in the
order picked, each once. Anything in the list that isn't an id is kept as stored and ignored; an item in the Trash or
gone is ignored too. The first consistency check (src/core/checks) reads them: a frame in a day needing a live item
the day's list doesn't have.

## Call sheet props (4.1)

A `callsheet` record (under a `shoot_day`) holds what a day's call sheet adds to the project's own records; everything
else on the sheet (the day, locations, scenes, cast, crew) is read from the records and never copied. Props: `notes`
(the General notes) and `safety_notes` (the Safety notes), both text; an empty note takes its prop off. It is made by the
first note typed, in the same op group, never by viewing a day. Its parent is the day, so it goes with its day: a day in
the Trash hides it, and a restore brings it back. It is not trashed on its own. If a day has more than one live
`callsheet` (two computers, a merged file), the first by sort key is the call sheet and the others are ignored. Additive
(no table change, no schema number): `callsheet` was already a record type, and an older version keeps the records as
they are.

4.2 adds two props, both additive (no schema number; an older version keeps them as they are):

- `department_calls`: `{ "<department id>": "HH:MM" }`, a department's call where it differs from the day's crew call
  (`call_time` on the day). An empty value takes its key off, and the prop with its last key.
- `person_times`: `{ "<person id>": { "call": "HH:MM", "hmu_ready": "HH:MM", "on_set": "HH:MM" } }`. `call` is for
  anyone; `hmu_ready` and `on_set` are offered for cast only, and kept if present on anyone. An empty value takes its
  key off, and a person with nothing left is taken off. A person's call on the sheet is their own `call`; else the
  earliest `department_calls` among their departments; else the day's crew call; else none.

Values that aren't a time, and keys this version doesn't know, read as unset and are written back as they were when
another key is written; a prop that isn't an object is never written over.

## Issued call sheets (4.7)

Issuing a call sheet keeps the PDF as sent. It is a `media` record of kind `pdf` whose parent is the day's `callsheet`
record (made in the same op group when the day has none). Its bytes are in `media_files` by SHA-256, as an attachment's
are (3.11, at most 50 MB), and it has the attachment props `file` (the SHA-256), `source_name` (the file name, with
` v2` before `.pdf` from version 2) and `byte_size`, and:

- `issue_version`: 1, 2, 3…, the highest live issue's plus one. An undone issue's record is gone, so its number is used
  again.
- `issued_at`: ISO time. `issued_by`: the author as the op log records it.
- `fingerprint`: SHA-256 (hex) of the text of everything the PDF prints except the forecast and the issue header: a
  stable JSON (keys sorted) of the sheet's data, the directions links included, the language and the paper not. The
  Call sheet tile compares the newest live issue's with the sheet as it is and shows "Changed since issued".
- `fingerprint_version`: 1. It names the frozen recipe that made `fingerprint`; a recipe is never edited once issues exist,
  a change is a new recipe under the next number. It hashes stored values (the date, the place, the zone, the country
  code, the hospital as kept, the map app's id), not what the app works out from them (links, sun times, emergency
  numbers, distances). The tile compares the live sheet with the newest issue by that issue's own recipe, so an upgrade
  alone never makes an issue read as changed. An issue whose version this app has no recipe for (or with no fingerprint)
  can't be compared: the tile makes no claim either way and still offers the next version.
- `issued_zone`: the IANA zone the header's issue time was written in.

The same op group sets `numbers_locked` on each live scene of the day that was not locked, exactly as the Scenes tile's
lock does (frames get their letters and the slate numbers are kept). A version cannot be deleted on its own; it goes
with its day or with an undo. It is not listed in Assets. Additive: no table change, no schema number; an older version
keeps the records as they are.

## Person props (3.5)

A `person` record (under the project) is one person on the production, cast or crew. Props: `name`; `role` (one of the
app's role ids: `director`, `dp`, `producer`, `first-ad`, `gaffer`, `key-grip`, `production-designer`, `hmu`,
`wardrobe`, `sound`, `editor`, `cast`, `client`, `other`; missing or odd reads as none); `departments` (a list of
department ids, kept in the call sheet's order; unknown ids are ignored); `title` (the call sheet's free text),
`phone`, `email`, `notes` (text); `custom` (their own fields, as a shot's). The phone and email are private: shown in
the app, never logged, never shown in History. No table change.

`full_view` (3.6c, approved by Kevin Nov 9 as an additive change; no schema number, since an older version keeps the
prop as it is and only shows every department, as before): true or false, set from the person's Full view switch.
Missing or odd means never set: then it's on for a director or a DP (a role that approves) and off for everyone else.
Off, the app shows that person's own departments first, the rest under Rest of crew, once they've picked themselves
with This is me. A focus view, not access: the file holds everything for whoever opens it.

`contact_on_sheet` (4.2, additive: no schema number, since an older version keeps the prop as it is and prints no
contact on a call sheet it doesn't have): true or false, set from the person's "Phone and email on call sheets" switch.
Missing or odd means never set: then it's off for someone who is only cast (departments exactly `cast`, or none and
the role `cast`) and on for everyone else. A call sheet prints a person's phone and email only when it is on, and only
for people on the day (`people_ids`). Never logged, never named in History.

`cast_id` on a `character` (3.5b): the person who plays them, by id; missing means no one yet. A person in the Trash
reads as none; their characters keep the id, so a restore gives them back. After Empty Trash the id names nothing and
reads as no one, as a scene's `location_id` does. No table change.

## Trash

The Trash holds deleted items until they're restored or the Trash is emptied. It's separate from an archived project
(the project's `state`, below): the names differ in the UI, the code and this file so the two never mix.

- Deleting a frame, shot, scene, note, media item or location (3.3) is a `trash` op. It sets `trashed_at` and
  `trashed_by`, and undo clears them. Restoring from the Trash is a `restore` op, so a restore can be undone too.
- A trashed location's scenes keep their `location_id`, so restoring it puts them back with it; views read a scene as
  having no location meanwhile. Typing or importing its name again restores it rather than making a second. Empty
  Trash deletes it for good, and its scenes' `location_id` then names nothing, which every view reads as no location.
- Trashing a scene trashes its live shots and notes in the same op group (polish 5, Delete scene), so one restore
  brings the whole scene back. A board (5.0) goes the same way with its items.
- Restore (1.20, src/features/trash/trash.ts) brings back what an item needs to be seen again, in its op group: a
  frame or a note's scene when that's in the Trash too, with everything trashed with that scene (polish 5), and the
  frame's scene's numbers (unless locked). A frame's
  old picture comes back as the frame's picture, sending the one it has now to the Trash. A scene comes back with
  the frames and notes trashed in its op group (same `trashed_at` and `trashed_by`), not ones trashed before it.
  Erased sketch strokes aren't listed in the Trash; undo brings them back.
- A deletion approved from a change file is the same `trash` op, with the approver as `trashed_by`. Its op group also
  marks the suggestion approved, so undoing the approval undoes both.
- Views, rollups, call sheets, checks and MCP reads skip records with `trashed_at` set unless the caller asks for them.
- Empty Trash, after a confirm, deletes the trashed records, their children and their media bytes for good. Older ops
  that touched them lose those records' data and can no longer be undone. Named versions lose them too; backups keep
  them until they're pruned.
- As built in 1.21 (src/core/ops/ops.ts, `emptyTrash`), in one transaction: every trashed scene, shot, note and media
  record and everything under it is deleted (an erased stroke on a frame still on the board stays, with its ops),
  and so are records that exist only in History and could only come back under what's deleted (a note made and
  undone in a deleted scene: every parent they ever had is gone); their ops keep their rows but `before` and `after` become null; an
  `empty_trash` group of `purge` ops (one per deleted record) is written with `undo_top` and `redo_top` null, so
  neither stack reaches past it; and stored pictures nothing left refers to (no record's props, no remaining op) are
  deleted with their thumbnails. A restore to a point before it never brings a deleted record back, and a record that
  sat under a deleted parent at that point stays where it is.
- Clean up old pictures (1.21, Settings → Storage, after a confirm) deletes stored pictures no record uses, live or
  in the Trash, though older ops may (a picture added and undone), and no named version's step shows (1.23). The log
  is unchanged; a step that brings such a record back shows its picture as removed.

## Boards (5.0)

A `board` record (under the project) is one moodboard; its `board_item` records are what is drawn on it. Both record types
were always in the list, so there is no migration and no schema number (additive, approved with Phase 5 decision 1).

`board` props:
- `kind`: `moodboard`, or `deck` (5.5): a board of ordered page frames, presented page by page. Anything else reads as a moodboard.
  A deck also has `page_format` (`16:9`, `9:16`, `4:5`, `a4` or `letter`; the format "Add page" begins with; a missing or odd value
  reads as `16:9`) and, for `a4` and `letter`, `page_orientation` (`portrait` or `landscape`; missing reads as portrait). A deck has no
  `department` and a name; it lists in the Moodboard section with the boards, marked as a deck.
- `scene_ids`, `character_ids`, `location_ids` (5.4): lists of record ids, the scenes, characters and locations the board is about
  ("Linked to: SC 04, MAYA, Rooftop" in the board's strip). Missing or empty is none; an emptied list is taken off the record.
  Additive: no migration, no schema_version change. A linked record in the Trash is not shown, but its id stays in the list,
  so restoring it brings the link back; one deleted for good simply never shows. The links are read the other way (the boards
  that link to a scene, character or location) by scanning the live boards, never stored on the scene, character or location.
- `department`: a department id, or `null` for a free board. A department's board is made the first time it is opened,
  never ahead, so a new project has none. At most one board per department is outside the Trash; a department's board in
  the Trash is restored when that department's board is opened, never made twice.
- `name`: the board's name, or `null`. A department's board has `name: null` and reads as its department's label in the
  language in use (stored values never change with the language); a free board has a name. Renaming a department's
  board is not offered.
- Boards sort among the project's boards by `sort_key`, in the order they were made.

`board_item` props (5.0 had one kind, a rectangle; 5.1a added shapes in colour, text boxes and sticky notes):
- `kind`: `rect`, `ellipse`, `triangle`, `diamond`, `text`, `sticky` (5.1a), `picture`, `video` or `link` (5.1b), `connector` (5.2), `section` (5.3), `shot_card`, `scene_card`, `palette_card` or `brand_card` (5.4), or `page` or `field_card` (5.5). An item whose `kind` this version doesn't know is
  kept and not shown.
- `x`, `y`: the item's top left corner before rotation, in world units. World units are abstract: nothing in the file
  assumes pixels, so Phase 6's plans can give them a scale in metres.
- `width`, `height`: world units, never below 8. Anything smaller reads as 8.
- `rotation`: degrees, clockwise, round the item's centre; 0 up to but not including 360. Missing reads as 0.
- A shape (`rect`, `ellipse`, `triangle`, `diamond`; 5.1a) has optional `fill` and `stroke`, each a `#RRGGBB` string
  (read in either case, kept upper case; anything else reads as not set). Colours are stored as seen, not as theme
  tokens: board content is the person's, so it doesn't follow the theme and prints as seen. A shape without `fill` draws in
  the board's raised colour `#C9C1B1` and one without `stroke` with the board's ink `#16150F` 1.5px outline, as a 5.0
  rectangle always did (in the light theme; from 5.1a these are fixed, in both themes).
- **A missing colour reads as ink; board content is never themed.** A text box with no `color` is ink `#16150F`, on
  screen and in print, in light and dark. The board's canvas is always the paper `#EEE9DF` in both themes, so ink stays
  readable on it; only the controls around the canvas follow the theme. Anything that draws a board (the PDF of 5.6, a deck)
  resolves a missing colour the same way: ink for text and outlines, paper for the page, `#C9C1B1` for an unfilled shape.
  A shape's hit area is its bounding box.
- A `text` item (5.1a) has `text` (the words, with a newline character for new lines), `font_family` (a family name; default `Inter Tight`),
  `font_weight` (100 to 900, rounded to the nearest 100; default 400), `font_italic` (boolean; default false), `font_size` (world
  units, 4 to 1000; default 24), `color` (`#RRGGBB`; missing reads as ink `#16150F`) and `align` (`left`,
  `center` or `right`; default `left`). The box's `width` wraps the text; its `height` is what the text takes at that width
  and is written again whenever the text, font, size or width changes.
- A `sticky` item (5.1a) is a square note with `text`, the same font props (default size 20), `align`, and `color`: its
  background, one of six fixed colours `#FFE97A`, `#FFC9A8`, `#FFB8C8`, `#BFE8B0`, `#B5DDF5`, `#D9C8F0` (missing, or any colour outside the six, reads as
  the first). Its text is always ink (`#16150F`), whatever the theme; each colour passes AA (4.5 to 1) with that ink.
- A `picture` item (5.1b) has only geometry; its picture is its `media` child, a record of kind `image` under the item
  (as a frame's picture is its shot's child), with the props of any stored picture: `file` (the SHA-256 of the stored
  picture in `media_files`, at most 2560 px on the long edge, with its 640 px thumbnail in `thumbnails`), `mime`, `width`,
  `height`, `color_space`, and `source_name` and `source_path` (a pointer to the original, relative to the .sbd's folder
  when it is inside it, absolute otherwise; a pasted picture has neither). **The original is never embedded.** Placed, the
  item's long edge is 400 world units and its shorter edge keeps the picture's aspect. Several files dropped together land
  side by side, left to right, 16 units apart, from the drop point, in one op group. Copy, paste and duplicate make a new
  item and a new `media` record with the same `file`: the bytes are stored once. The copy lives inside the app and carries no bytes: pictures and video cards paste only into the project they were
  copied in (into another they are left out, with a notice, and the other kinds paste), and one whose stored picture has
  since been deleted for good is left out too.
- A `video` item (5.1b) has only geometry; its video is its `media` child of kind `video` (the props of a linked video,
  see Videos: `source_name`, `source_path`, `source_size`, `duration_frames`, `fps`, `width`, `height` and the rest),
  which keeps the file where it is, never copied in, with a `poster` (an image `media` record under the video, the first
  frame, from the frames' pipeline). The card draws the poster, the file name and the length as timecode; its playback
  copy is made as a frame's video's is. A card's video is its own record, not one shared with a frame's.
- A `link` item (5.1b) has `url` (http or https only; an address of any other scheme is not a link card) and an optional
  `title` the person types. The card shows the title, else the address's host and path. Nothing is fetched: no title or
  preview is ever read from the page.
- Trashing a picture, video or link item trashes the item only; its `media` child stays under it, so Restore brings the
  item back whole. Empty Trash deletes the item with everything under it, and the stored picture bytes with them unless
  another record (a frame's picture, another item) or an older step of one still names the same `file`.
- A `connector` item (5.2) joins two things on the board and has no `x`, `y`, `width` or `height` of its own: its path is worked
  out when it is drawn, from its ends. Its props:
  - `from` and `to`: each an object, either `{ "item": <board_item id>, "side": "top" | "right" | "bottom" | "left" | "auto" }`
    (attached) or `{ "x": number, "y": number }` (free, world units). An unknown side reads as `auto`, which picks the side
    facing the other end each time it is drawn. An end that is neither reads the whole connector as unknown (kept, not shown).
  - `route`: `straight` (default), `elbow` (right angles only: it leaves an attached side perpendicular and at least 16 units
    out, then turns at right angles, at most five segments: out, across, along, across, in; between two free ends, one bend; it
    never crosses either box it joins, and two facing sides closer than 32 units split the room, each leaving by half of it) or `curved` (a cubic Bézier
    whose control points leave each attached end perpendicular to its side by a third of the distance; a free end aims at
    the other end). For a turned item the side is the turned side: anchors are the rotated side midpoints, and an elbow
    uses the right angle nearest the turned side's normal.
  - `start_head` and `end_head`: `none` or `arrow` (defaults `none` and `arrow`). The head sits at the very end, pointing
    along the last segment's direction.
  - `color`: `#RRGGBB`; missing reads as ink `#16150F` (board content is never themed). `width`: line width in world units,
    0.5 to 24, default 1.5. `label`: text drawn at the path's middle on a paper patch; missing or empty is none.
  - An attached end follows its item live: moving, resizing or turning an item writes nothing to its connectors. A new
    connector is given a sort key before every other sibling's, so it draws under the items it joins. A connector whose
    attached item is in the Trash, or gone, is not shown until the item is back. A connector may be attached to an item of
    its own board only.
  - Trashing an item trashes the connectors attached to it in the same op group (same `trashed_at` and `trashed_by`). The
    Trash does not list those: it lists the item, and Restore brings the item back with every connector trashed with it, even
    when the connector's other item is still in the Trash: it then stays hidden until that item is back, and is never listed on
    its own. A connector deleted on its own is listed ("Connector on Camera board")
    and restored alone; if one of its items is in the Trash it stays hidden until that item is back. Empty Trash deletes a
    connector listed on its own as any other row, and every connector attached to an item it deletes, live or in the Trash, so
    none is left hanging from nothing.
  - Copy and paste: a connector copied with both of its items is pasted attached to their copies; copied without one of them
    (or with a picture left out of a paste) that end is pasted free where it was; an end that was free moves with the paste.
    The text put on the system clipboard is the connector's label, if it has one.
  - Quick-create (the "+" handles beside one selected sticky note, shape or text box, or ⌘⌥ + an arrow, Ctrl+Shift on Windows):
    one op group makes a copy of the item's kind and style (text empty) 80 units beyond the chosen side, aligned to it and
    turned as it is, and a connector from the original's side to the copy's facing side.
- A `section` item (5.3) is a frame that groups what lies inside it: `x`, `y`, `width`, `height` like any item and no
  rotation (always upright; a stored `rotation` reads as 0), `name` (text, may be empty or missing: it then shows "Section"),
  and `color`, one of six light tints `#E4E8D2`, `#DCE6EE`, `#EEDDD2`, `#E6DDEE`, `#F2E7C9`, `#D6EADF` (missing, or any
  colour outside the six, reads as the first; each passes AA, 4.5 to 1, with ink `#16150F`; fixed, never themed).
  - **What a section holds is worked out, never stored.** It holds the items, and the other sections, whose upright
    rectangle (rotation included) lies wholly inside its box, found again each time it is needed (when a gesture starts, a
    nudge or a layout command is written, a count is announced). Items keep the board as their parent; no record changes
    when something is put in a section or taken out of one, and nothing in the file lists a section's contents.
  - Moving a section (a drag, an arrow-key nudge, Align or Tidy up) moves what it holds in the same op group, by the same
    distance, and the free ends (`{ x, y }`) of connectors that lie inside its box. An attached end follows its item as in
    5.2. Resizing a section moves nothing else. Items already moving with the selection are not moved twice.
  - Draw order: sections first, then connectors, then every other item. Among sections, one wholly inside another is always
    drawn above it, and otherwise the sibling order decides. A section is under what it holds, and its z-order commands
    (forward, backward, front, back) move it among the sections only. A section drawn round other sections is also given a
    sort key before the first of them.
  - The name is drawn above the section's top left corner, 16 world units in Inter Tight bold, and is part of its hit area.
  - Delete trashes the section only; its contents stay where they are. Copy, paste and duplicate of a section alone copy
    only the section; with its contents selected as well they come too. The Trash lists it as "Section 'Act One' on Camera
    board" ("Section on Camera board" without a name).
  - Layout commands change `x` and `y` only (Align, Distribute, Tidy up). The group holds a row for every item the command
    covered, moved or not, which is how History says "Aligned 3 items".
- A **live card** (5.4) shows a record of the project as it is now. It stores which record it shows and nothing it draws: `x`, `y`,
  `width`, `height` and `rotation` like any item, and
  - `shot_card`: `shot_id`, the frame. Drawn from the frame as it is: its picture (the thumbnail, the full picture up close, cropped as
    the storyboard crops it) or else its sketch, its number exactly as on the slate, its shot size, lens and movement, and its
    status shape (Have ■, Need to shoot □, Source ◩).
  - `scene_card`: `scene_id`, the scene. Its heading as the board shows it ("SC 04 INT. KITCHEN — NIGHT"), how many frames it has,
    and its first four frames' thumbnails.
  - `palette_card`: `scene_id`. The scene's `palette` (see Storyboard props) as it is now, swatches in order with their hex.
  - `brand_card`: no other prop. The project's company (see Project record props): its name, its logo picture, brand colours
    and brand fonts, each font set in its own face.
  A card whose frame or scene is in the Trash is drawn dimmed with "In the Trash" and stays on the board; one whose record is gone
  for good says "Shot removed" or "Scene removed". Neither is an error, and nothing is written to the card. Edits to the frame
  change the card with no op on the card. Cards keep their aspect when resized. Copy and paste within the project copy the
  card; into another project a card naming a frame or scene is left out (with the notice of 5.1b), since its record is not there.
  Double-click or Enter on a shot or scene card selects the frame or scene in the Storyboard (one in the Trash opens the Trash
  tile filtered to it instead). The Trash lists a card as "Shot card 4A on Camera board" and History as "Added shot card 4A".
- A **page** (5.5) is a frame of a deck, like a section but with a format: `x`, `y`, `width`, `height` like any item, always upright
  (`rotation` is 0), and
  - `format`: `16:9` (1920 × 1080), `9:16` (1080 × 1920), `4:5` (1080 × 1350), `a4` (1240 × 1754) or `letter` (1275 × 1650), in world
    units, portrait; an odd or missing value reads as `16:9`. `orientation` (`portrait` or `landscape`, for `a4` and `letter` only; the size
    is swapped for landscape). The size is written when the page is made; resizing keeps the format's ratio and rewrites `width` and `height`.
  - `name`: may be empty. `background`: `#RRGGBB`, default `#FFFFFF`; board content, never themed.
  - **Page order is the pages' sibling order** (`sort_key` among the pages only); a page's number is its place in it. Z order commands
    leave pages alone.
  - **What a page holds is worked out, never stored**, as for a section: the live items wholly inside its box. Moving a page moves them
    in the same op group (and the free ends of connectors inside it). An item inside no page is working space: it is never printed
    or presented.
  - Pages are drawn with the sections, under the connectors and the items; a section wholly inside a page is drawn above it. The page's
    number and name are drawn above its top left corner. Pages exist only on a deck.
  - Add page puts a page of the deck's format 200 units right of the last page (level with it); Duplicate page copies the page and
    what it holds (connectors among them) in one op group; Delete page trashes the page alone and what it held stays as working
    space; reordering is one `move`. The Trash lists a page as "Page 3 'The look' on Pitch deck" and History as "page 'The look'".
- A **field card** (5.5) shows one field of the project as it is now, like the live cards of 5.4: `field` (`title`, `logline`, `format`,
  `runtime`, `company`, `dates`, `cast` or `crew`) and the text style of a text box (`font_family`, `font_weight`, `font_italic`,
  `font_size`, `color`, `align`), no `text`. `title` is the project's `title`; `logline`, `format` and `runtime` are the project's
  production details; `company` the attached company's name; `dates` the first and last shoot day (or "Dates to come"); `cast`
  each character and who plays them; `crew` the people outside Cast by department in call-sheet order, name and role. Never a phone,
  an email, an address or a note: decks go to clients. A field with nothing to show draws its name muted on screen and nothing in a
  presentation. Edits to the project change the card with no op on the card.
- A font is named, never stored: `font_family`, `font_weight` and `font_italic` are all a board keeps. The bundled fonts
  (Inter Tight, JetBrains Mono, Archivo, Bodoni Moda, Jost, Outfit) come first, then this computer's, listed through
  Rust (font-kit; CoreText on macOS, DirectWrite on Windows, so Adobe Fonts that are activated appear). A board that names
  a font this computer lacks draws it in Inter Tight and says so once; the name stays stored, so the right font shows
  again on a computer that has it. The font's OpenType `fsType` bits are read when its bytes are loaded and kept in memory
  for the PDF rule of 5.6 (a font whose bits forbid embedding is never embedded); they are not stored in the project.
- **Z order is the sibling order** (decision 1's "z order"): the items' `sort_key`s, back to front, as for every record's
  ordered children (src/core/ops/order.ts). Bringing an item to the front is a `move` op to a key after the last item's;
  a reorder of several items writes those items' rows only. The first is at the back. Siblings in the Trash, and items
  of a kind this version doesn't show, keep their keys and are never moved or tied: a new key is made between them and
  the neighbours, so no two siblings share one. A reorder that changes nothing among the items that show writes nothing.

Edits are ops like any other. Typing into a text box or sticky note in place is one op group, written when editing ends
(Escape, or a click outside), never one per keystroke; a new text box left empty writes nothing at all. A property
change on several selected items is one group. One gesture is one op group: a drag, a resize, a rotate or a reorder of several items is
one group, written when the gesture ends; a nudge by an arrow key is one group per key press; a paste is one group.
Selection, tool and each board's view (zoom 10% to 800%, and where it is looking) are view state, kept in memory for the
session: never an op, never in the project.

Deleting a board or an item is a `trash` op, so the Trash lists it (a board by its name or department; an item as
"Rectangle on Camera board") and Restore is a `restore` op. Trashing a board trashes its live items in the same op group
(same `trashed_at` and `trashed_by`); restoring the board restores those items, not ones deleted before it. Restoring an
item whose board is in the Trash brings the board back with it. Both kinds are among what Empty Trash deletes, a board
with everything under it. Views skip trashed records. Boards and items are in both JSON exports (the Trash and History
only in the full archive) and round-trip with every other record.

## Project record props

These need no table change: they're props on the project record. They're listed because the web review copy, exports
and MCP read them.

| Prop | Value | Notes |
|---|---|---|
| state | `draft`, `active` or `archived` | Archive Project sets `archived`. New projects start as `draft`, as in the prototype; a missing value reads as `active`. The production stage is a separate prop, `stage` |
| stage | `discovery`, `contract`, `preproduction`, `production`, `editing`, `revising`, `pending_invoice`, `complete`, or null | 3.1. The job's progress, as in Kevin's Notion projects; null or missing means none. Never mixed with `state` |
| logline, format, runtime | text | 3.1. Free text: `TVC · 60s`, `12 min` |
| client | `name`, `company`, `email`, `phone` (text) | 3.1. The client contact. Private: shown in the app, never logged. Fields this version doesn't know are kept |
| deliverables | array of `id` (UUID), `text`, `done` (true or false) | 3.1. The deliverables checklist, in order. Fields this version doesn't know are kept |
| company | `profile_id`, `name`, `address`, `phone`, `email`, `website` (text), `logo_id` (a media record under the project, or null), `logo_source` (a mark of the logo copied, to tell whether the profile's changed), `brand_colors` (up to 8 `#RRGGBB`, upper case, each once; 5.4), `brand_fonts` (up to 3 font family names; 5.4) | 3.2. The production company, copied from a profile saved in the app's settings on some computer; it stays as copied until Update from profile. Its logo is a picture (schema 3) whose media record has `role` = `company_logo`; replaced or detached, it goes to the Trash, which doesn't list it on its own (undo brings it back with the company) but counts and clears it with Empty Trash. `logo_source` is null when the project holds no logo. Fields this version doesn't know are kept. `brand_colors` and `brand_fonts` (5.4, the brand kit) are copied from the profile on attach and on Update from profile, as the other details are; a company copied before 5.4 has neither, which reads as none. Anything in them that isn't a `#RRGGBB` colour, or past the limits, is dropped when read |
| theme | object (below) | Phase 1 |
| watermark | `text`, `position` (`top-left`, `top-right`, `center`, `bottom-left`, `bottom-right`), `opacity` (0.05 to 1), `applies_to` (any of `pdf`, `png`, `review`) | 1.24, Watermark Settings. Missing, or empty text, means no watermark |
| aspect_ratio | `2.39:1`, `2:1`, `1.85:1`, `16:9`, `4:3`, `1:1`, `4:5`, `9:16` | 1.6. The storyboard's frame shape; missing reads as `16:9` |
| shot_letters_allow_io | true or false | 1.6. Shot letters skip I and O unless this is true |

Changing any of them is an op, so it undoes and shows in History.

## Storyboard props (1.6)

Scenes are `scene` records under the project, and each frame is a `shot` record under its scene (one panel per
shot), both ordered by `sort_key`. Like every prop, a missing or unreadable value reads as empty.

| Record | Prop | Value | Notes |
|---|---|---|---|
| scene | number | text | As in the script and on the slate: `4`, `4A`, `12`. A scene added between 4 and 5 is `4A` |
| scene | name | text | Shown as the heading until INT/EXT or DAY/NIGHT is set. Older files may have `heading` instead |
| scene | int_ext | `INT`, `EXT`, `INT/EXT` | |
| scene | day_night | `DAY`, `NIGHT`, `DAWN`, `DUSK`, `MAGIC HOUR` | |
| scene | location_id | record id | A `location` record (1.12, script import). Set from the board's "/" menu, by name |
| scene | page_eighths | integer | Script length in eighths of a page (1.17); shown as "1 3/8 pg" |
| scene | character_ids | array of text | Speaking characters, as the ids of the project's `character` records, in the script's order (schema 12; `characters`, an array of names, before it) |
| scene | palette | `{ size, colors: [{ hex, locked? }] }` | Polish PP (approved Nov 5; a prop, no table change). The scene's colours from its frames' pictures: `hex` is sRGB `#RRGGBB` as shown on screen (a Display P3 picture is converted colour-managed), `locked` keeps a colour in place when the rest are generated again, `size` (1 to 16, default 8) is how many Generate makes. Missing for a scene without one, as in every older file. With no colours it keeps only its `size`. Fields this version doesn't know are kept |
| location | name | text | 1.12. As typed in the "/" menu, or as the script writes the place (`DINER - BACK ROOM`) |
| character | name | text | 1.17. A speaking character from script import, without extensions such as (V.O.). One per name, whatever its case |
| character | cast_id | id | 3.5b. The person who plays them; missing, trashed or gone reads as no one |
| scene | numbers_locked | true or false | Locks the scene's shot numbers (below) |
| scene | department_approvals | object by department id | 3.6b (schema 9). `{ "camera": [{ "name": "Kevin Matos", "roles": ["dp"], "at": "<ISO time>", "basis": "3:<14 hex digits>" }] }`: the director's or the DP's sign-offs on the whole scene, named as shot approvals were (the approver's name as it was then, or initials, or empty; one person who is both is one approval with both roles). `basis` fingerprints what the department touched in the scene when it was given (cyrb53 over canonical JSON, src/core/model/sceneApprovals.ts). From 3.18 it starts `3:` and covers what `2:` does plus the scene's `character_ids` and `characters` for every department, and each live frame's `t_stop`, `support` and `height` for `camera` and `grip-electric`. A `basis` starting `2:` (3.15's rule) is still read by it, which covers, for every department, the shared fields: the scene's `name`, `heading`, `int_ext`, `day_night` and `location_id`; its live frames in sibling order, each with its `action`, `dialogue`, `size`, `lens_mm`, `move`, `crop`, `clip` and `location_id`, its picture's stored file (the media record's `file`, a sha256) and its strokes' ids; and, for that department alone, its own entry in each frame's `department_status` but `priority` and `approvals` (its `working`, `done` and notes; a value of `false`, `null` or `""` is the same as none). A `basis` without a prefix was made by 3.6b's rule and is still read by it: the scene's props but this one; its live frames and note cards in sibling order, each frame's props but `department_status`, its picture's file and its strokes' ids; and that department's `working` and `done` on each frame. A prefix this version doesn't know reads as changed. Each sign-off is read by the rule it was made with, so a new rule never turns one changed; given again, it takes the newest. When it no longer matches, the app shows "Changed since approval". Missing or empty for a scene without approvals. Departments, approvals and fields this version doesn't know are kept as they are |
| shot | number | text | The full slate number, `4B`; stored, so exports and editors see exactly the board's numbers |
| shot | title | text | Nov 5 (a prop, no table change): an optional title, "Mary wipes the counter", edited in place. Missing for none, as in every older file; an emptied title is taken off |
| shot | size | `EWS`, `WS`, `MS`, `MCU`, `CU`, `ECU`, `INSERT` | |
| shot | lens_mm | number | Focal length |
| shot | t_stop | number | |
| shot | support, height, move | text | From lists in the inspector (1.8); free text is kept |
| shot | status | `have`, `need`, `source` | A new frame is `need` |
| shot | action, dialogue | text | |
| shot | department_status | object by department id | Polish 6 (schema 6). `{ "camera": { "priority": true, "working": true, "done": true } }`: only what's set. Until schema 9 an entry also kept `approvals`, the frame's own sign-offs by the director or the DP (`{ name, roles, at }`); migration 9 moved them to the scene (`department_approvals`) and took them off. One read from an older point in History is written back as stored. Ids and fields this version doesn't know are kept as they are. Department ids: src/core/model/department.ts |
| shot | departments | array of department ids | Before schema 6 only: read as Priority, taken off by the migration |
| shot | media_id | record id | 1.11. The `media` record the frame shows, a child of the shot. Missing for an empty frame |
| shot | crop | `{ x, y, zoom }` | 1.11. How the picture sits in the frame (below). Missing means centred at zoom 1 |
| shot | shoot_day_id | record id | 3.7. The `shoot_day` it's shot on. Missing, in the Trash or gone reads as unscheduled |
| shot | custom | object of text by field name | 1.19. The frame's own fields (`{ "Drone": "Mavic 3" }`), in the order added. Missing when it has none. The project's list of field names isn't stored: it's every name its live shots use |

**Sketches** (1.13, src/features/storyboard/sketch/strokes.ts). Each stroke of a frame's sketch is a `stroke` record
under its shot, ordered by `sort_key` as drawn, so the History never copies earlier strokes into later ones.

| Prop | Value | Notes |
|---|---|---|
| tool | `pen`, `arrow`, `box` | A box is a framing rectangle |
| points | array of numbers | x, y, x, y… as fractions of the frame (0 to 1 across and down), to four places. An arrow or a box has two points: its ends, or two corners |
| width | number | Line width as a fraction of the frame's height: 0.004, 0.008 or 0.016 |
| pressures | array of numbers | One per point, 0 to 1, only when a pen reported real pressure; a stroke without it has one width |

The eraser takes off whole strokes it touches: each pass, and Clear, trashes them in one op group, so one undo brings
them back. Erased strokes are trashed records, not things a person deleted: the Trash tile (1.20) leaves them out, and
Empty Trash purges them with the frames they belong to.

Strokes are fractions of the frame, so a change of the project's aspect ratio stretches a sketch to the new shape,
while the frame's picture re-crops instead. Redraw a sketch after changing the aspect ratio of a boarded project.

**Notes and locations** (1.12). A note card is a `note` record under its scene, ordered among the scene's shots by
`sort_key`, with one prop, `text`. Notes take no shot number. A `location` record sits under the project with one prop
so far, `name`; the "/" menu reuses a location whose name matches, whatever its case, before it makes a new one.
Phase 3 adds addresses, contacts and parking. New sort keys among a scene's shots and notes are worked out with the
trashed ones included, so a restored item never shares a key with one added since.

**Frame pictures** (1.11, src/features/storyboard/framePictures.ts). A frame's picture is a `media` record under its
shot, and the shot's `media_id` names it. Replacing or removing the picture trashes that media record in the same op
group, so undo brings it back and the bytes stay for History. Several pictures dropped or pasted at once land in one
op group, so one undo takes back the drop. The picture always fills the frame at the project's aspect ratio: at zoom 1
it just covers it, cropped on its long side; `zoom` goes up to 4; `x` and `y` (0 to 1, across and down) are the point
of the picture at the frame's centre. A reader clamps the crop, so the picture never leaves a gap, even after the
aspect ratio changes. src/core/media/crop.ts does the arithmetic.

**Shot numbers** (src/core/model/shotNumbers.ts). A shot is its scene's number plus a letter: A to Z, skipping I and
O unless the project allows them, then AA, AB. While a scene is unlocked, its numbers follow the board, so adding,
moving or deleting a frame renumbers the scene in the same op group. Locked, every shot keeps its number, even if the
scene is renumbered; a new frame takes the next letter after the highest ever used, trashed frames and the scene's
slate numbers included (schema 5, above), so no number in a locked scene is given out twice. Unlocking renumbers the scene to follow
the board again.

### theme

| Field | Notes |
|---|---|
| version | 1 |
| source | `default` (no image: the kit's theme), `image` (from the logo or key image) or `manual` (accent typed in) |
| image_id | The `media` record of the logo or key image, a child of the project; null for `default`. Replacing the image, or Reset to default, trashes that record in the same op group (1.16) |
| mode | `light` or `dark`: the project's preferred mode. A person's Appearance setting can override it |
| candidates | The extracted accents, most saturated first, usually 3 or 4 |
| accent_picked | The accent the person chose or typed, before the contrast adjustment |
| family | The background family the accent's hue snapped to: one of `paper`, `sand`, `clay`, `rose`, `plum`, `violet`, `navy`, `slate`, `teal`, `sage`, `olive`, `ochre` |
| generator | Version of the generator that produced `tokens` |
| tokens | `light` and `dark`, each with `bg`, `surface`, `surface_raised`, `border`, `border_top`, `text`, `text_muted`, `text_inverse`, `accent`, `accent_contrast` |

- The tokens are stored, not recomputed when the project opens, so a newer generator never changes an approved look.
  Regenerate in Settings → Theme recomputes them on purpose.
- A project with no `theme` uses the default theme. No migration writes one in, so every change to a project's theme
  is an op in History (decided Nov 2).

## Migrations (milestone 0.4)

- Migrations live in src/core/storage/migrations, numbered from 1; a file's schema version is the number it has run.
- Before upgrading an existing file, a copy (a clone on a Mac, as below) is written beside it as
  `<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm` (local time). Migration backups are never pruned.
- Each migration runs in its own transaction together with its `schema_version` bump, so a failure leaves the file at
  the last version that completed.
- A file from a newer schema is refused, unchanged, with "Update Storiiboard to open it".
- A file without a `meta` table is refused as "not a Storiiboard project", unless the app has just created it empty.
  Nothing is added to a file that isn't a project.

## Backups (milestone 0.4; clones and the cap Nov 3)

- Every 5 minutes while a project is open, and only if it changed since the last backup, a copy is written to
  `Backups/<Project> YYYY-MM-DD HH-mm.sbd` in the folder that holds the .sbd. `<Project>` is the .sbd's file name and
  the time is local, for example `Backups/Bey County 2026-11-02 14-05.sbd`. A second backup in the same minute (Back
  up now, Compact project) is `Bey County 2026-11-02 14-05 (2).sbd`, then `(3)`: a name never carries a time that
  hasn't come yet (Kevin, Nov 4, 1.28). Pruning orders a minute's copies by their number.
- A project in a synced folder (iCloud Drive, Dropbox, Google Drive, OneDrive) keeps them in the app's data folder on
  this computer instead (1.4), so a full copy doesn't upload every 5 minutes or sync into conflicts. The folder is
  `Backups/<Project> <key>/` there; Files next to a project, below, has the key. Settings → Backups can keep them next
  to the project.
- On a Mac a backup is an APFS clone of the .sbd (`clonefile`), taken between transactions so nothing in it is
  half-written; with a `-journal` left beside the file by a write that didn't finish, it's a full copy instead. A clone
  shares every block the project hasn't changed since, so it takes almost no space; Time Machine and other copy tools
  still see a complete file. Sharing blocks also means a clone covers a damaged or wrongly edited file, not a failing
  drive.
- Where a clone isn't possible (Windows, exFAT and other drives that aren't APFS, a backups folder on another volume),
  the backup is a full copy made with SQLite's online backup API, up to 1024 pages (4 MB) a step, fewer on a drive
  slow enough that a step takes over 20 ms. Between steps the app lets go of the project, so edits go on, and they
  reach the copy as they're made. The copy is written to `<backup>.partial`, flushed to disk between steps, synced
  once more at the end and only then renamed, never over an existing file. A copy cut off by closing the project or a
  sync replacing it is deleted at once; one cut off by a crash or a quit is deleted when the next backup starts. It
  never sits under a backup's name.
- A copy that finds the file held by another program for about ten seconds stops with "Another program is using the
  project file, so the backup stopped."; the next one tries again.
- Either way the file is never copied with a raw file copy, and each backup is a complete .sbd that opens on its own.
- Measured Nov 3 on a 614 MB project (1000 frames), with an edit every 5 ms on this Mac, where a commit takes about
  14 ms: a clone took under 15 ms and held an edit at most 29 ms; a full copy took about 3 s and held an edit at most
  25 ms. `VACUUM INTO`, used before, held an edit for 1.2 s. The test is `measures_how_long_a_backup_holds_up_an_edit`
  in src-tauri/src/sbd.rs. Windows, which always makes full copies, hasn't been measured; CI runs the copy's tests
  there.
- "Changed" means a row was written through the open connection since the last backup. Opening a project (its
  migration, its `app_version`) doesn't count, so opening alone never makes a backup.
- Pruning runs after each backup. It keeps the newest 12 backups, plus the newest one from each of the last 14 calendar
  days (today included), and deletes the rest. Both numbers are in Settings → Backups.
- Then a cap: a project's backups share 5 GB (10^9 bytes). Each counts the space only it takes, which is what deleting
  it alone would free: all of a full copy, and for a clone only the blocks no other file still shares (APFS's private
  size), which starts at nothing. A drive that keeps no private sizes (exFAT, HFS+, a network share) counts every
  backup in full. Over the cap, the oldest go first, but the newest 3 always stay, however large. For clones the total
  is a lower bound: a block two old clones still share, and the project no longer has, counts for neither, so the cap
  bounds full copies and only roughly bounds clones.
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

## Project data as JSON (2.9)

Export → Full archive (JSON) writes the whole .sbd as one UTF-8 JSON file, and Import project data… (the Projects
screen) makes a new project from one (src/core/storage/projectJson.ts). It's the project, not a view of it, so unlike
the other exports it carries everything: every record, live and in the Trash; the History (every op and op group);
named versions; pictures and thumbnails; LUTs; slate numbers; Seen. Imported, the new file holds exactly what the old
one did, every value of every row in the same order, but for its own `meta.file_id` (a new file keys its own local
backups) and `meta.app_version`, which every open writes. SQLite's own row numbers aren't kept, only their order
(nothing reads them). Every record keeps its id, the project record's included, so the copy and the original share
them: a later change file or review copy keyed by project id (Phases 7 and 9) must tell the two files apart by
`file_id`.

Export → Project data (JSON), the default of the two (3.14, Kevin Nov 9), leaves out the Trash and History, since they
can hold deleted material and everyone's names. It writes every table, with these rows left out:
- `records`: every record in the Trash and everything under it (what Empty Trash deletes, and the kinds it doesn't,
  such as an erased sketch stroke with who erased it); `shot_seen` rows of those frames;
- `media_files` and `thumbnails`: pictures no record left names (by the SHA-256 in its props);
- `op_groups`, `ops`, `versions` (points in History), `notification_cursors` and `notification_reads` (they read
  History) and `lookups` (a cache, which can hold a deleted location's address): no rows.

Everything else is as in the full archive, `slate_numbers` included (a number once on a slate is never given again).
A record left may name one left out (a frame's location in the Trash): it reads as none, as after Empty Trash.
Imported, the new project holds exactly what the file did, with no History; exported again it's the same file but for
`file_id` and `app_version`. The header says which it is: `"contents": "project_data"` or `"full_archive"` (a file from
before 3.14 has no `contents`, and is a full archive).

```json
{"format":"storiiboard-project","format_version":1,"schema_version":8,"app_version":"0.1.0","exported_at":"2026-11-07T12:00:00.000Z","contents":"full_archive","tables":{
"meta":{"columns":["id","key","value","created_at","updated_at"],"rows":[
["…","schema_version","8","…","…"],
…
]},
"records":{"columns":[…],"rows":[
…
]}
}}
```

- `tables` holds every table of the file, by its name, with its `columns` in the schema's order and its `rows` in the
  order SQLite stored them, one row to a line, so the file reads (and diffs) a row at a time.
- A value is JSON's own: text as a string (a JSON column such as `props` stays the text it is), an integer as a number,
  null as null, and a blob (a picture's bytes) as `{"base64": "…"}`. Every column today is TEXT, INTEGER or BLOB
  (all tables are STRICT), so nothing is rounded.
- Tables come in the order rows refer to each other: meta, media_files, thumbnails, luts, records, op_groups, ops,
  versions, slate_numbers, shot_seen, then any other by name. A table a later schema adds is carried without a change
  to the code, which reads the tables the file has, as long as it's an ordinary rowid table (a WITHOUT ROWID or
  full-text table would need one).
- The export reads one consistent project: if an edit lands while it reads (a still being grabbed), it reads again,
  and after three tries says so rather than write a file that might not import. It's refused before anything is read
  if the project is too large to import back.
- Import refuses a file that isn't UTF-8 JSON in this format, a `format_version` above 1 or a `schema_version` above
  this app's (update Storiiboard), a meta `schema_version` row that isn't the header's, any table or column the named
  schema doesn't have, and rows SQLite won't take as they are (a thumbnail of a picture that isn't there). It builds a new .sbd at that
  `schema_version`, puts every row in in one transaction (foreign keys checked at commit), and opening it then
  upgrades it as any older file is, with a migration backup beside it. It never writes over a file.
- Limits: the page reads the file in one piece, so a project JSON of more than about 400 million characters (roughly
  300 MB of pictures) is refused as too large to import. Video stays outside the project as before: a video record's
  path, relative to the old .sbd, may need Relink if the new file sits elsewhere.

## File type

The installers register `.sbd` as "Storiiboard Project", with Storiiboard as its owner, so a double-click opens it.
On macOS the exported type is `app.storiiboard.project`, conforming to `public.data` and `public.database`; the
MIME type is `application/vnd.storiiboard.project`.

## Compact project (1.27)

Settings → Storage → Compact project rewrites the file without its free space (src/core/storage/compact.ts). Space a
deletion frees inside the file (Empty Trash, Clean up old pictures) is reused for new work, but the file doesn't
shrink; and space freed by builds before 1.21 can still hold old text (see Trash). Compacting removes both from the
project file; the backup made first keeps them until it's pruned. Nothing compacts on its own (Kevin, Nov 4).

1. A backup of the file as it is, as one of the project's scheduled backups (`Backups/`, or the local folder for a
   synced project), taking its turn with them: no other copy of the file is made until the compaction ends. When
   nothing has changed since the schedule's newest backup, that one stands for it. A new one is named for this minute,
   with `(2)` on when a backup made earlier this minute has the name (see Backups); backups are never overwritten, and
   pruning never deletes the one just made. The newest stands only while
   it's still in the Backups folder. A failed backup compacts nothing.
2. SQLite's VACUUM on the open file, in place, after the same on-disk check as a write; refused while a backup copy of
   the file is still being made. It's one write through the rollback journal, so a crash or a kill partway leaves the
   file as it was, rolled back the next time it's opened on this computer (`survives_a_kill_mid_compact` in sbd.rs
   kills it partway through the rewrite, with the file's pages already overwritten, and at moments across the run). A
   sync that replaced the file while it ran sends the app to the newer file, as for any replaced file. It can need up
   to twice the project's size in free disk space: SQLite's temporary copy in the system's temp folder (on a Mac, the
   system volume, even for a project on another drive) and a journal beside the file; short of space, it fails with
   nothing changed.
3. The format, the records, History and every other table are unchanged. The store reads the slate numbers again
   afterwards, since VACUUM may renumber a table's rowids.

Everything that reads or writes project files waits while it runs (one lock covers them), edits and pictures
included; on a large project that's a while, so don't quit meanwhile. A project in a synced folder uploads again in
full afterwards, and is half rewritten while it runs, so another computer shouldn't open it until it's done; the lock
file is refreshed just before, and goes stale after 5 minutes. A Mac backup clone made before stops sharing space with
the project.

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
| `Backups/<Project> YYYY-MM-DD HH-mm.sbd`, `… HH-mm (2).sbd` to `(99)` | Automatic backups (a minute's later copies numbered, 1.28; a copy Windows Explorer's "Keep both" names `(2)` counts as one too) (APFS clones on a Mac, full copies elsewhere), for a project in an ordinary folder. A project in a synced folder keeps them in the app's data folder on this computer instead, in `Backups/<Project> <key>/`, where `<key>` is 8 hex digits of an FNV-1a hash of its `file_id` and path, so copies of a project never share a folder. Settings → Backups can keep them next to the project | 0.4, 1.4, 1.10b | 12 plus one a day for 14 days; within 5 GB, the newest 3 always |
| `Backups/<Project> YYYY-MM-DD HH-mm.sbd.partial` (or `… (2).sbd.partial`), `<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm.partial` | A full copy being made, renamed to its backup name once complete. The migration one sits beside the project, so in a synced folder it uploads while it's written | 1.10b | Deleted when cut off, or when the next backup starts |
| `<name>.sbd.bak-v<from>-YYYY-MM-DD HH-mm` | Copy made before a migration | 0.4 | Never pruned |
| `<Project> YYYY-MM-DD HH-mm (from backup).sbd`, `… HH-mm (2) (from backup).sbd` | A backup opened with Open backup: a separate project, copied out of `Backups/` with VACUUM INTO. A second copy of the same backup is `(from backup 2)` | 0.7 | Like any project |
| `.<Project>.sbd.lock` | While the project is open: which computer has it open. JSON: `app`, `computer` (its name), `machine` (a random id per install), `session`, `opened_at` and `refreshed_at` (ms since the epoch). Hidden: a leading dot on Mac, the hidden attribute on Windows | 1.2 | Deleted on close; rewritten every minute while open; stale after 5 minutes |
| `<Project> (copy).sbd` | Open a copy, chosen when another computer has the project open. A separate project | 1.2 | Like any project |
| `<Project> (<version>).sbd` | Open version: a copy restored to a named version's step, a separate project. A second copy of the same version is `(<version> 2)` | 1.23 | Like any project |
| `.<Project> (<version>) <8 hex digits>.sbd` | Open version's draft while it's copied and restored, renamed to the copy's name once it's ready. Hidden: a leading dot on Mac, the hidden attribute on Windows (cleared before the rename) | 1.23 | Deleted if Open version fails. One a crash cuts off stays, hidden, until the person deletes it: the app never deletes a project-shaped file it didn't just make |
| `<name>.sbdchanges` | Suggestions from the web review copy | Phase 7 (import), Phase 9 (web) | Wherever the person saved it |
| `<name>.sbdpack` | Zip of the .sbd and every linked file (Collect Project) | Phase 8 | |
| Review package | Compressed review copy: the records reviewers may see, compressed images, theme and watermark. Uploaded on Publish, or exported as a file | Phase 9 | On the web, 30 days after the last shoot day |

## Change log

| Schema | Milestone | Change |
|---|---|---|
| 1 | 0.4 | First schema: meta, records (with `trashed_at` and `trashed_by`), ops |
| 2 | 0.5b | Append-only History: `op_groups`; `ops.state` and `meta.undo_cursor` removed. Each v1 `undone` or `discarded` mark becomes an `undo` group where that undo must have happened, and `ops.seq` is renumbered to follow the groups |
| 3 | 1.10 | Pictures: `media_files` and `thumbnails`, addressed by SHA-256; record types `note`, `character` and `stroke` |
| 4 | 1.23 | Named versions: `versions` |
| 5 | 1.26 | Slate numbers: `slate_numbers`; `meta.slate_numbers_unknown` |
| 6 | Polish 6 | Department status: each shot's `departments` list becomes `department_status`, the departments that were on as Priority. No table change |
| 7 | Polish 6b | Seen: `shot_seen` |
| 8 | 2.2 | Video: `media` records of kind `video`, the shot prop `clip`, the picture prop `from_video`; `luts` |
| 9 | 3.6b | Approvals per scene: the scene prop `department_approvals`, carried from the frames' where every frame had one; `approvals` off every shot's `department_status`. No table change |
| 10 | 3.10 | Notification read state: `notification_cursors`, `notification_reads` |
| 11 | 3.4 | Cached network lookups: `lookups` |
| 12 | 3.13 | Scene characters as ids: `characters` (names) becomes `character_ids`, characters made for names with none. No table change |
| 13 | 3.18 | Approvals kept through schema 12: sign-offs it left "Changed" re-stamped by their own rule. No table change |

Project props (`state`, `theme`, `watermark`) and suggestion records need no table change, so they have no schema
number.
Boards (5.0) are the `board` and `board_item` record types and their props (see Boards); they need no table change either.
5.1a adds item kinds and props to `board_item` (shapes with `fill` and `stroke`, `text` and `sticky` items): additive, no table
change and no schema number; an older version keeps an item of a kind it doesn't know and doesn't show it.
5.1b adds the `picture`, `video` and `link` kinds to `board_item` (with `url` and `title` on a link) and `media` records
under a picture or video item: additive, no table change, no migration and no schema_version change.
5.2 adds the `connector` kind to `board_item` (with `from`, `to`, `route`, `start_head`, `end_head`, `color`, `width` and `label`): additive, no
table change, no migration and no schema_version change; an older version keeps a connector and doesn't show it.
5.3 adds the `section` kind to `board_item` (with `name` and `color`; its contents are worked out, not stored): additive, no table
change, no migration and no schema_version change; an older version keeps a section and doesn't show it.
5.4 adds the live card kinds `shot_card`, `scene_card`, `palette_card` and `brand_card` to `board_item` (with `shot_id` or `scene_id`), the
board props `scene_ids`, `character_ids` and `location_ids`, and the project's `company` value gains `brand_colors` and `brand_fonts`: additive, no table
change, no migration and no schema_version change; an older version keeps a card and doesn't show it, and ignores the rest.
5.5 adds the board `kind` `deck` (with `page_format` and `page_orientation`) and the `board_item` kinds `page` (with `format`, `orientation`, `name` and `background`;
its contents are worked out, not stored) and `field_card` (with `field` and a text box's style): additive, no table change, no migration and
no schema_version change; an older version keeps a deck as a board and a page or field card as an item it doesn't show.
