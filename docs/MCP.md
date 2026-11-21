# The MCP server

Storiiboard's MCP server lets an AI assistant (Claude Desktop, Claude Code, any MCP client) read a project (its scenes,
frames, schedule, call sheets, people, gear, locations, bird's-eye plans and suggestions), run the project's checks, and
suggest changes. Built in 7.5 (reading) and 7.6 (checking and proposing; Phase 7, docs/PHASE7_DECISIONS.md decisions 1,
2, 3, 4, 5, 14, 15 and 16). It never changes the project: a suggestion is written as a change file beside it, and a
person applies or rejects each one in the app ("The one write", below).

**Everything the server returns goes to the assistant's maker** (Anthropic for Claude, and so on), as part of the
conversation. That is why it never returns contact details, never returns a stored file, and reads only the project
files it was started with.

## What it is

- A Node program in `mcp/` that shares the app's own code in `src/core` (the records, the readers, the sun, the field
  of view, the schedule's totals): nothing is worked out a second way. Phase 8 packs it as a Claude Desktop bundle
  (.mcpb); until then it runs from the repo with your own Node, 22.16 or later (`node:sqlite` needs no flag from
  22.13, and the statement's `setReturnArrays` and `columns`, which the server reads with, came in 22.16).
- Its two packages, `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7, are in `mcp/package.json` and
  `mcp/package-lock.json` only, never in the app (a test fails if anything under `src/` imports them).
- The app never depends on `mcp/`: the app's TypeScript project, its lint and its tests leave `mcp/` out, and pass
  without `mcp/node_modules`. The server has its own (`mcp/tsconfig.json`, `mcp/eslint.config.js`,
  `mcp/vitest.config.ts`), run with the repo's own TypeScript, eslint and Vitest:

  ```sh
  npm run typecheck --prefix mcp
  npm run lint --prefix mcp
  npm test --prefix mcp
  ```
- Transport: stdio. The assistant's app starts the server itself and talks to it over its standard input and output.
  Local HTTP (127.0.0.1, an Origin check and a token) comes in 7.10.
- It makes no request: there is no network code in `mcp/` (a test reads the source and the built file for it).

## Build and start

From the repo folder:

```sh
npm ci                       # the repo's own tools first: the build uses its Vite (Node 22.18, as the README says)
npm ci --prefix mcp          # the server's two packages
npm run build --prefix mcp   # bundles mcp/src and src/core into mcp/dist/server.js
```

The build uses the Vite the repo already has (no other tool): `src/core` imports without file extensions, as the
app's bundler reads it, so the server is bundled into one ES module for Node, with the SDK and zod read from
`mcp/node_modules` when it runs. `mcp/dist/` is build output and never committed. After updating Storiiboard, build
the server again: a project saved by a newer version is refused until you do ("Rebuild the server").

To start it by hand (an assistant's app does this for you):

```sh
node mcp/dist/server.js "/Users/robin/Shoots/Harbor Lights.sbd"
```

Give it one or more `.sbd` files. It reads only those: a tool asked for any other file is refused.

## Connect Claude Desktop

Settings → Developer → Edit Config opens `claude_desktop_config.json`. Add the server, with the full path to `node`,
to the built file and to each project (paths here are made up). Claude Desktop doesn't start a server from your
shell, so a bare `node` may not be found, or may be another Node: give the full path that `which node` prints in
Terminal (Mac) or `where node` in PowerShell or Command Prompt (Windows), and check `node --version` is 22.16 or later.

```json
{
  "mcpServers": {
    "storiiboard": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/robin/Code/storiiboard/mcp/dist/server.js", "/Users/robin/Shoots/Harbor Lights.sbd"]
    }
  }
}
```

On Windows, the same with Windows paths, each backslash doubled:

```json
{
  "mcpServers": {
    "storiiboard": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\robin\\Code\\storiiboard\\mcp\\dist\\server.js", "C:\\Users\\robin\\Shoots\\Harbor Lights.sbd"]
    }
  }
}
```

Two projects of the same name in two folders are both fine: the server numbers them in the order its arguments give
them ("Harbor Lights (1)", "Harbor Lights (2)"), takes that label (or the path) as the project's name, and asks for one
of them when a call names only the shared name. A number whose label is another file's own name is skipped (with a
real `Harbor Lights (2).sbd` beside them, the two are `(1)` and `(3)`), and a path given twice is one project. It never
tells the assistant a folder's name, which can name a person or a client.

Quit Claude Desktop and open it again; the seventeen Storiiboard tools are listed under the tools button.

## Connect Claude Code

```sh
claude mcp add storiiboard -- node /Users/robin/Code/storiiboard/mcp/dist/server.js "/Users/robin/Shoots/Harbor Lights.sbd"
```

`claude mcp list` shows it; in a session, `/mcp` shows its tools.

## Read-only, and how that is known

- The file is opened with SQLite's read-only flag (`node:sqlite`'s `readOnly`, SQLITE_OPEN_READONLY) and `query_only`
  on. Not `immutable`: the app may be saving to the file meanwhile, and a read-only connection still takes SQLite's
  shared lock, so a read never sees half a save. In the app's journal mode (DELETE) such a connection creates no file
  beside the project. A `file:` URI with `mode=ro` says the same, but Node 22's `DatabaseSync` doesn't document URIs,
  so the flag is used.
- Every call opens the file, reads the records, and closes it, so the assistant sees the project as it is now, and
  nothing is held open between calls. A call's reads (the schema version, the records, Seen marks, slate numbers) run
  in one read transaction (`BEGIN … COMMIT`), so they are one snapshot: a save can't land between two of them.
- A file in WAL mode (bytes 18 and 19 of its header are 2, read with `fs` before SQLite opens it) is refused, since a
  read-only connection to it would make `-wal` and `-shm` files beside it: "Open it in Storiiboard once". A file left
  mid-save (a hot journal, SQLite's `SQLITE_READONLY_ROLLBACK`) is refused in the same words; the journal is left for
  the app to roll back. While the app is saving (SQLite busy, after a 2 s wait): "saving right now, try again".
- No lock file is read or written, no backup is made, and no migration ever runs: a file of an older format is refused
  ("open it in Storiiboard once"), a newer one with "Rebuild the server (npm run build --prefix mcp) after updating
  Storiiboard".
- mcp/test/server.test.ts runs a session of every tool and checks the project's bytes and its folder's listing (names,
  sizes, times) are the same before, during and after; the WAL refusal is checked the same way. The test's own build
  goes to `test-results/7.5/dist-test/`, never over `mcp/dist`.

## The one write (7.6)

The propose tools are the server's first and only write (Phase 7 decision 3: the assistant never writes the .sbd).
Each call writes **one new change file** (`.sbdchanges`, docs/SBD_FORMAT.md "Change files") into the project's own
`<Project> Suggestions/` folder beside it, `<Project>` being the .sbd's file name less `.sbd` (as the app names it,
Rust's `file_stem`: `Harbor.Lights.sbd` has `Harbor.Lights Suggestions/`; the server reads only files whose names end in
`.sbd` with something before it), and nothing else anywhere: never the
.sbd (it is still opened read-only, as above), never another folder, never a file it didn't just make, never over an
existing file.

- **Bounds first** (round 2), before anything in the call is read: the whole arguments at most 256 KB as JSON, at most
  200 suggestions a call, at most 50 fields an update or a create, each field's name at most 100 characters and its
  value at most 10,000.
- **Checked before anything is written**, in this order (round 4). First what the call alone decides: every
  suggestion's kind, type and fields against the assistant's scope row (outside it is refused), then the free-text rule
  on every value and note (one that reads as a phone number, an email, coordinates or a map link is refused: contact
  details are never suggested), then the row's checks that read no records (round 5: a value's length, its choices,
  its range and shape, in 7.0's own words: "HUGE" for a size, 25:00 for a crew call). Then a stored value already past
  its own row bound (an action longer than 10,000 characters, a gear list holding something that isn't an id) is
  refused in fixed words, whatever was sent ("SC 12 · 12B: what the project holds in action is more than a suggestion
  can carry. Change it in Storiiboard."). Then every size (round 5): the file as it would be with each `before` value at
  a fixed reserve, the largest its field's row bound lets it be as UTF-8 JSON at its worst (`stored` in the scope row:
  a text's characters at 6 bytes each, a list of ids at 500 UUIDs, a short value at 20 characters), read by the app's
  own change-file reader (7.1, src/core/storage/changeFile.ts) within its bounds (5 MB, 256 KB a suggestion, 10,000
  characters a string, 2,000 suggestions), so whether the call is too large is decided by what was sent and the
  reserves alone. Only then is the real file built; it can only be smaller, and the server asserts that the same reader
  passes it. A suggestion naming many long fields is counted at their reserves, so a call of more than about 80 changes
  to a frame's action is refused as larger than 5 MB: suggest fewer at a time. Then every suggestion is read by the
  app's own reader (`reviewSuggestion`, 7.0) under the assistant's scope row, beside the others of its file, against
  the project as it is, for its flags alone (round 5: no edit worked out, so the work never depends on whether a value
  equals the stored one): one with a flag (a value its field doesn't take, a focal length outside the lens picked, a frame that can't
  leave a locked scene) is refused, and so is the whole call. Two flags are let through: *waiting* on another
  suggestion of the same file (a new scene's frames, a frame after a new one), and *nothing to change* (round 4: the
  suggestion is written like any other; the review screen says the project already reads so, and Apply only marks it
  applied). A refusal says why in words and writes nothing, so the assistant can try again.
- **The rule** (rounds 4 and 5): no answer, refusal, count, later listing or timing depends on comparing what the
  assistant sent with a value it can't see; a check may compare with what the read tools show it (the view and the
  guard), never with the hidden stored text. One residual the server can't close: once a person applies a suggestion,
  what it sent is the project's own, and the read tools hide a stored contact in it as they hide any.
- **No contact oracle** (rounds 2 and 3). Nothing the assistant sends is matched against the values the project
  stores: the guard keeps stored contacts out of what goes *to* the assistant, and what it sends it holds already, so
  a match would protect nothing and its trace (a replacement, a bound crossed after one) would say which guess was
  stored. A value the project stores, typed again in a form the free-text rule can't recognise, is written exactly as
  sent, like any other: one build, one read, one answer, whatever the values. No answer repeats a value the assistant
  gave: it says what was written by counts and by labels made from the project's own records ("Change SC 12 · 12B: 2
  fields."), through the free-text rule and the guard; a name the call gave that matches nothing is refused without
  repeating it. A refusal that repeats the assistant's own argument (`There's no frame numbered "99Z"`) is a function
  of that argument alone. So nothing the assistant is told differs by whether a value it gave is one the project
  stores.
- **A name two records share** (round 2) is refused, never guessed: "Two gear items are named "SkyPanel S60": give its
  id (list_gear lists them)"; likewise people and locations, each record's name through the free-text rule and the
  guard. Each also takes its id. A name is compared with each record's name as list_gear, list_people and
  list_locations give it (round 4: the free-text rule and then the guard, so "SkyPanel [contact left out]" finds what
  list_gear lists so, and "Cam 5550123", whose digits are a stored phone's, finds nothing either way), and a name to
  look up that the free-text rule would change is refused without a look at any record ("A name to look up can't hold
  what reads as a phone number…: give the gear item's id"), so a phone typed in a record's name can't be confirmed by
  guessing it.
- **The file**: 7.1's format, `format: "storiiboard.changes"`, `version: 1`, a new `id` every call (a writer never adds
  to a file it wrote), `project_id` and `project_name` from the project as read, `created_by: "mcp"`, and one person,
  `{ "id": "a", "name": <the client's own name>, "role": "assistant" }`: the name the assistant's app gave itself in
  the MCP initialize request (its `title`, else its `name`, such as "Claude Desktop"), as text, cleaned and at most
  100 characters. Each suggestion's `before` values come from the project as read, only for fields in the scope row
  (round 4); a call sheet's calls and times only for the keys named, each as the sheet reads it (round 5: "HH:MM" or
  null, what *changed since* compares, so their reserve is a function of the keys sent). Its name is
  `<YYYY-MM-DD HH-mm-ssZ> <client> <8 hex>.sbdchanges`: the time in UTC (round 2: never this computer's zone, which
  would say where it is), the client's name as the client names itself (Claude Desktop may say "claude-ai"), kept to
  letters, digits, spaces, dots, dashes and underscores (at most 40), and the first 8 hex digits of the file's id, so
  a name never repeats. The answer gives the file's id and the folder's name, never the file's name or path.
- **How it is written**: whole, as a temporary file in the same folder whose name the app's listing skips (it ends in
  `.writing`, not `.sbdchanges`), opened only if nothing of that name is there, flushed; then put in place under its
  name by a hard link, which fails if anything of that name is there, and the temporary name taken away. A volume with
  no hard links (exFAT, FAT, some network shares) gets a copy that fails if anything of the name is there
  (`COPYFILE_EXCL`), then the temporary file taken away; never a rename, which would replace a file. A write that
  fails takes its temporary file away.
- **The folder it checked** (round 2): once the temporary file is open, its real folder must be the real folder found
  with the same device and inode (round 3: on Windows too, where NTFS gives a volume serial and a file index), and again
  just before the link; a folder swapped for another or
  for a link meanwhile is refused ("The Suggestions folder changed while the file was being written").
- **Its own leftovers** (round 2): before it writes, the server takes away temporary files a crash left in the folder:
  only regular files named exactly as its own temporary files are
  (`.<YYYY-MM-DD HH-mm-ssZ> <client> <8 hex>.sbdchanges.<8 hex>.writing`) and over an hour old. Nothing else in the
  folder is ever removed.
- **Never past what the app reads** (rounds 2 and 3): a call is refused when the change files waiting in the folder,
  with the one it would write, would be more than 1,000 files or 50 MB, in words that say what the person can do
  ("1,000 change files are waiting in Harbor Lights Suggestions: bring them in (Bring in, in the status line) or move
  some out of the folder."). Only files not yet brought in count: the server reads the change-file ids the project's
  log names (the app's own `everBroughtIn`, and each suggestion's `change_file_id`) and knows a file by the 8 hex of a
  name it wrote, or else by the file's own `id` (each read within the app's 5 MB, at most 50 MB read in all); a file it
  can't read counts as waiting. The app reads the files it hasn't brought in newest first, so a new one comes in even
  when old ones fill what one pass reads. The new file counts at its reserve (round 5), never its real size, which holds
  the stored `before` values; the files already waiting count at their real size. That is a residual: their sizes hold
  earlier calls' `before` values, so it would take about 50 MB of waiting files, files a person sees in the folder and
  in the status line, before the room's answer could turn on one.
- **A late failure leaves nothing** (round 2): when the marker or the file can't be written after this call made the
  folder, the call takes that folder away again with the marker it wrote (only a folder it made, only once empty), and
  answers in words.
- **The folder**: found as the app finds it (src-tauri/src/changes.rs): a real folder, not a link or a junction, whose
  real parent is the project's own folder. When there is none, it is made with its marker, `storiiboard-folder.json`
  (`{ "format": "storiiboard.suggestions-folder", "project_id", "project_name" }`), and nothing else. A folder of that
  name whose marker names another project is refused in words ("is for another project, Saltmarsh"), and so is a link,
  a junction or a file where the folder would be. A renamed project: with no `<Project> Suggestions/`, a folder beside
  it named `<anything> Suggestions` whose marker names this project (and with no `<anything>.sbd` beside it) is the
  project's folder, as the app finds it, and is written into; a second one is never made. The app asks to rename that
  folder before it brings its files in, and the answer says so.
- **Then**: Storiiboard brings the file in when the project opens, as one step that can be undone, or offers it (a
  line and Bring in) when its window comes back to the front. Each suggestion arrives in the Suggestions tile, in a
  group "From Claude Desktop, through the assistant", and a person applies or rejects each one; nothing changes until
  then.
- mcp/test/propose.test.ts runs every propose tool over stdio and checks each wrote exactly one file, that 7.1's reader
  accepts it and 7.0's reader reads its suggestions unflagged; that a refused value writes nothing (the folder isn't
  even made); that the project's bytes and everything else beside it are unchanged; that names and ids never repeat;
  that another project's folder is refused; and (mcp/test/writeAndChecks.test.ts) that a failed write leaves no
  temporary file and a file of the same name is never written over. Round 2 adds the probe (an answer alike whether or
  not a value given is stored), the bounds, names two records share, the folder named from the stem, the full folder,
  the leftovers, the folder made and taken away, a folder swapped mid-write, and (mcp/test/noHardLinks.test.ts) the
  copy on a volume with no hard links. Round 4 adds the review's probes: a phone the free-text rule hides, and a value
  the guard hides (in a frame's action and in a call sheet's notes), sent back exactly and a character off, answered,
  written and listed alike; a name the guard hides finding no single item, guessed right or wrong; and a field outside
  the scope row refused alike whatever is stored in it. Round 5 adds the review's probe of sizes: two projects whose
  hidden addresses differ by one character, the call sized so the real suggestion is 256 KB in one and a byte over in
  the other, answered alike; the real file within its reserve and passed by 7.1's reader for every tool; a stored value
  past its bound refused in fixed words whatever was sent; the row's record-free checks run first; the new file counted
  at its reserve in the room check; and the flags-only review giving the full review's flags but `no_change` on every
  earlier round's case, with no copy of the records whether a value equals the stored one or not.

## What is never returned, and why

Settings → AI assistant says it in one line (en and es): "Stored contact details (phone numbers, emails, addresses,
parking, coordinates) are never sent to the assistant; the server reads them only to keep them out of what it sends.
Sun times worked out from a location's place are sent. Text people type goes as typed, with phone numbers, emails,
coordinates and map links taken out where they can be recognised."

One function decides what an assistant may read of each record type: `assistantView` in
src/core/model/assistantView.ts. Every tool reads the project through it. Its table lists every prop of every record
type, given or left out with why; a test fails on a prop the app reads that the table doesn't list, so a new prop is
decided before an assistant can read it.

- **Contact details** (decision 14): a person's phone, email and notes, whether their contact prints on call sheets,
  their own custom fields; a location's address, contact name, phone and email, parking, its own custom fields; a
  frame's own custom fields (a custom field may hold a contact; left out to fail closed); the hospital's address and
  phone; the client's contact and the company's address, phone, email and website.
- **Places** (question 20): a location's place on the map, its coordinates and the map's name for it; the hospital's
  coordinates; a sun path's own coordinates; a scout photo's place and time. A sun or window hours worked out at a
  scout photo's place and time are left out too, since they would say them. The sun's and a window's bearings and
  altitudes are given to a whole degree and the hospital's distance to a whole kilometre, since finer numbers narrow
  down where the place is; sunrise, sunset and the hours stay `HH:mm`.
- **This computer's time zone**: the server looks no zone up, and a location with no zone typed gets
  `{ zone: null, missing: "noZone" }` and no sun times on a call sheet, never times in the zone of the computer the
  server runs on.
- **Text people type** (notes, action, dialogue, names, titles) goes to the assistant as typed, with phone numbers,
  emails, coordinates and map links taken out where they can be recognised; so does every string a tool returns (a
  reader's own words, a cast member's character names, a suggestion's values, a refusal's words). Stored contact
  fields are never sent (above): the server reads them only to keep them out of what it sends (the guard, below). The rule reads the text Unicode-aware: format characters (`\p{Cf}`: zero width
  spaces, soft hyphens) are dropped and the text normalised (NFKC), so full-width digits or a "＠" read as plain ones.
  Then, replaced with `[contact left out]`:
  - map links, with everything after them to the next whitespace (a place's name in one can hold an apostrophe or
    brackets: `St+Mary's+Church`, `Pier+9+(North)`; one closing bracket the link didn't open is the sentence's and
    stays): `maps.google.`, `google.<tld>/maps` (`www.google.com/maps/…!3d…!4d…`), `goo.gl/maps`, `maps.app.goo.gl`,
    `share.google`, `maps.apple.` and `maps.apple/`, `openstreetmap.org`, `osm.org`, `waze.com/ul`, `bing.com/maps`,
    what3words (`///word.word.word`, `w3w.co`), and plus codes (`849VCWC8+R9`, in capitals, with a letter in them, so
    `85mm+2x` stays);
  - emails, with an `@` or a lookalike: `＠`, `(at)` or `[at]`, ` at `, an `@` with a space on both sides, and ` dot `
    or `(dot)` for a dot (`name at example dot com`). A domain written with plain dots ends in any two or more
    letters; one with a spelled-out dot, or after a spaced `@` (where a dot is `.` or ` . `, never `. ` alone), ends in
    a common top-level domain (`COMMON_TLDS`: com, net, org, edu, gov, io, co, uk, es, fr, de, mx and others), never
    an English word (in, by, on, to, it, me, at, be, is, us, no, so, do, go, as), so `Eyeline at the dot on the
    C-stand` and `Crew call @ 0630. Shooting call @ 0730.` stay. An email in quotes or before `'s` is taken out, the
    quotes kept; the spelled ` at ` form never runs on into an apostrophe (`Meet at St.Mary's` stays). A handle
    (`@harbor.lights`) stays;
  - coordinate pairs (two decimals of 4 or more places, one within 90 and the other within 180, either way round, so
    `-118.2437, 34.0522` is one and frame rates such as `23.976, 29.970` stay; a pair that isn't on Earth leaves its
    second number to pair with the next) and degrees-minutes-seconds;
  - phone numbers: 7 or more digits (any script's) in groups joined by a space (any `\p{Zs}`), two spaces, any dash or
    `−`, a dot, a slash, `·`, or a dash with a space each side; a letter right against the digits doesn't stop one
    (`Robin555-0123`). A phone has a leading `+` or `(`; or is one run of 10 or more digits, or of 9 starting with 6
    to 9 (`612345678`); or two groups, the first of 3 digits or fewer or starting with 0, the last of 4 or more
    (`555-0123`); or three or more groups ending in one of 4 or more, or of 9 or more digits starting with 0
    (`06 12 34 56 78`, `0475 12 34 56`), or of 9 digits starting with 5 to 9 in groups of 2 or 3, however grouped
    (Spain's and Poland's `612 34 56 78`, `91 123 45 67`, `512 345 678`). Never a date (`2026-11-18`, `18.11.2026`,
    with or without a time after it), two groups whose first has 4 or more digits and doesn't start with 0 (night
    hours `1830-0630`, `2026-004512`), a range (two groups joined by a dash, the second 0 to 999 above the first:
    `993-1104`), a decimal of 5 or more places (`1.777778`), a camera's ISO steps after "ISO" (`ISO 800 1600 3200`),
    or other groups whose last has under 4 digits (`101 102 103`, `1 250 000`, `555.0123.88`). Ids are never touched.
  - Text in which nothing is taken out comes back exactly as stored, not normalised. Every pattern's start is anchored,
    so one very long word can't make the rule slow (100 KB of one word is read in well under 100 ms).
- **Suggestions' data**: each field is given or left out by the type of the record the suggestion acts on (its real
  target's type when the target is in the project), every value through the free-text rule; `fields_left_out` names a
  field only when it is a known prop, and counts the rest ("2 unknown fields"); its `type` only as text of at most 100
  characters, or null, and its `parent_id` and `after_id` only as UUIDs, or null. Its kind, target type and source are
  scrubbed and kept to 64 characters.
- **Files**: no picture, video, PDF, link or script, and no file path. A frame says only whether it has a picture.
- **The Trash**, unless a call asks with `include_trashed: true`; each trashed item is then marked `trashed`.
- **Board items, sketches, settings presets and availability**: no tool returns them (run_checks reads availability
  for its own check, and says only who is called while away).
- **Department flags** (Kevin, Nov 21): each department can say whether the assistant may read its files; what's
  marked no, the assistant can't touch, except for the director and people given permission. No record is a
  department's file yet (that comes with departments by file) and nothing stores the flag yet, so today nothing is
  hidden this way. The view already takes the flags (`DepartmentAccess`: `hidden`, the departments marked no, and
  `exempt`, the departments whose no doesn't hold for this reader: all of them for the director, and each that gave
  permission): a hidden department's material (a record carrying that `department`, and everything under it) is left
  out of every tool, and so is a suggestion whose target is hidden or whose data names the department. Tests prove
  both. Whether a frame's per-department statuses, a call sheet's department calls and a plan's layers count as a
  department's files is Kevin's question; until he answers, they are given as before.
- The project's switch "Let the assistant read contact details" (decision 14) isn't built: until it is, these tools
  never return them.

As a last check, the server looks in every answer's typed text for the contact-shaped values the project holds, and
replaces each it finds with `[contact left out]`, as the rule above does; it never refuses an answer. It never reads a
key or a number (a plan's positions are numbers). By the key a string sits under (mcp/src/guard.ts):

- slate and scene numbers (`number`, `scene`) are skipped;
- names the view gives (`name`, `label`, `company`, `cast`, `characters`, `plays`, `file_name`) are still searched for
  stored phones and emails; only addresses and coordinates are skipped there (a place may be named as its address
  begins);
- ids (`id`, `*_id`, `*_ids`) are skipped only when the value is a canonical UUID;
- nothing is skipped inside a suggestion's `data`, its `target.label` or its `author.name`: a change file wrote them;
- past its depth limit (32), a value is replaced whole, never returned unchecked.

What it looks for, both sides normalised (NFKC, case-folded, whitespace collapsed, format characters dropped):

- each phone-shaped part of a stored phone field (`555-0123 / 555-0199` is two; an `x 45` tail left out; a run of two
  numbers with only a slash or a space between, `555-0107/555-0199` or `555 0107 555 0199`, keeps each one's), and
  each phone number typed in left-out text (a person's notes, a location's notes, own fields' values), by its last 7
  digits, against every run of digits in a text string, with ids and ISO dates and date-times blanked first (so
  `555–0123` with an en dash, `5 5 5 0 1 2 3`, or full-width digits are caught);
- a stored email, and a stored address whole, each only as a whole word (`1 Main St` isn't inside `21 Main Street`);
- a stored coordinate, written with 4 or more places, to 4 places.

A contact's name, a client's name, an address's first part and parking text are not matched (they would take words out
of ordinary answers that share them); their props stay left out.

Times and zones: a location's typed time zone is used for its sun. The desktop app looks a zone up from a place on the
map (tzf-rs, in Rust); the server looks nothing up, so a location with no zone typed has no sun in `get_plan`
(`missing: "noZone"`), and on a call sheet `zone: null, missing: "noZone"` and no sun times.

## The tools

Every tool takes `project`: the project's file name without `.sbd` ("Harbor Lights") or its path, one of those the
server was started with; leave it out when it reads one project. Every answer is one JSON text. A refusal (a scene
that isn't there, a file of another format, a bad argument) is a tool error in words, saying what there is instead;
a wrong argument says which and what it takes (`list_scenes: include_trashed is true or false.`), never zod's list.
A refusal's words go through the free-text rule too, since they can repeat what the assistant asked for.
Lengths are metres, angles degrees, times `HH:mm` on a 24-hour clock in the place's zone, dates `YYYY-MM-DD`.

### project_summary

`{ project }` →

```
{ project: { id, file_name, title, state, stage, logline, format, runtime, notes, company, aspect_ratio, currency,
             minutes_per_setup, deliverables: [{ text, done }], schema_version },
  counts: { scenes, frames, frames_need_to_shoot, setups, shoot_days, people, characters, locations, gear_items,
            suggestions_pending },
  shoot_days: [{ id, number, date }],
  left_out: "<what these tools never return>" }
```

### list_scenes

`{ project, include_trashed? }` → `{ scenes: [{ id, number, label, name, int_ext, day_night, location: { id, name } |
null, pages, page_eighths, numbers_locked, characters: [{ id, name }], frames, setups: [{ id, number, name }],
trashed? }] }`, in board order. `number` is the slate's ("12", "4A"); `label` is the board's ("SC 12").

### list_shots

`{ project, scene?, shoot_day?, include_trashed? }`: a scene by its number ("12", "SC 12"), a day by its date or its
number. → `{ shoot_day?, shots: [{ id, number, scene: { id, number, label }, title, size, lens_mm, lens: { id, name,
squeeze } | null, t_stop, support, height, move, status, action, dialogue, location, shoot_day: { id, number, date } |
null, setup: { id, number, name } | null, gear: [{ id, name }], departments: [{ department, states }], has_picture,
trashed?, scene_trashed? }] }`. `status` is `have`, `need` or `source`; `states` are `priority`, `seen`, `working`,
`done`. A scene number finds a live scene first, then one in the Trash. With `include_trashed`, a live frame in a
trashed scene is marked `scene_trashed: true`.

### get_schedule

`{ project }` → `{ minutes_per_setup, days: [{ id, number, date, call_time, wrap_time, notes, totals: { frames, setups,
minutes }, scenes: [{ id, number, label }], frames: [{ id, number, status }], locations: [{ id, name, status }],
people: { called, confirmed, chosen }, gear: [{ id, name }] }], unscheduled_need_to_shoot: [{ id, number, scene }] }`.
Days in the app's order and numbering; totals are the app's (frames in one setup count once), and `called` and
`confirmed` are the app's own count (`dayCrew`). `project_summary`'s `state` is read as the app reads it
(`projectStateOf`: `draft`, `active` or `archived`).

### get_call_sheet

`{ project, day }`: the day's date or its number. → the sheet as the app builds it:

```
{ day: { id, number, of, date, call_time, wrap_time }, title,
  times_in: { zone, from } | { zone: null, missing: "noZone" } | null, nothing_left_to_shoot,
  scenes: [{ id, number, label, name, int_ext, day_night, pages, locations, frames,
             characters: [{ name, cast, on_day }] }],
  cast: [{ id, name, characters, call, hmu_ready, on_set }],
  crew: [{ department, call, people: [{ id, name, title, role, call }] }],
  people_chosen,
  locations: [{ id, name, status, power, notes, has_place,
                time_zone: { zone, from } | { zone: null, missing: "noZone" } | null,
                sun: { state, sunrise, sunset, golden_hour, blue_hour } | null,
                safety: { country_code, emergency_numbers: [{ kind, number }],
                          hospital: { name, emergency_department, distance_km } | null } }],
  notes: { general, safety }, issued: [{ version, issued_at }], left_out }
```

No phone or email, even for people whose contact prints on the sheet; no address, parking, map or forecast. A
location with no zone typed has `{ zone: null, missing: "noZone" }` and `sun: null`; `distance_km` is whole.

### list_people

`{ project, include_trashed? }` → `{ people: [{ id, name, role, departments, title, full_view, plays, trashed? }],
characters: [{ id, name, cast: { id, name } | null, trashed? }], left_out }`.

### list_gear

`{ project, include_trashed? }` → `{ currency, gear: [{ id, name, kind, department, quantity, source, owner, day_rate,
notes, watts, body?: { letter, sensor_mode, sensor_width_mm, sensor_height_mm, focal_lengths_full_frame_equivalent },
lens?: { focal_min_mm, focal_max_mm, squeeze }, trashed? }] }`. `kind` is `gear`, `camera_body` or `lens`.

### list_locations

`{ project, include_trashed? }` → `{ locations: [{ id, name, status, power, notes, time_zone, country_code, has_place,
pin_placed_by_hand, hospital: { name, emergency_department } | null, scenes, frames_shot_here, photos,
light_reference, trashed? }], left_out }`.

### get_plan

`{ project, scene, setup? }`: the setup by its number in the scene ("2") or its id; without one, the scene's room and
blocking. → a setup's plan in real units, as the plan draws it (Kevin's Nov 16 answer 16):

```
{ scene, setup: { id, number, name } | null, units,
  room: { id, name, location, ceiling_height_m } | null,
  north: { plan_rotation_deg, meaning } | null,
  walls: [{ id, level, name, start: { x_m, y_m }, end: { x_m, y_m }, length_m, thickness_m, height_m }],
  openings: [{ id, kind, level, name, wall_id, along_m, width_m, hinge?, swing?, height_m, sill_m?, top_m? }],
  cameras: [{ id, name, icon, x_m, y_m, width_m, depth_m, rotation_deg, letter, body, sensor_mode: { name, width_mm,
              height_mm }, lens: { from, focal_mm, squeeze, lens }, on_side,
              field_of_view: { horizontal_deg, frame_width_mm, focal_mm } | { missing }, height, frames,
              stops_at_walls }],
  lights: [{ id, name, icon, x_m, y_m, width_m, depth_m, rotation_deg, height_m, watts, watts_from, beam_deg,
             beam_direction_deg, gear }],
  watts: { total_known, lights, lights_without_watts },
  items: [{ id, kind, level, layer, name, x_m, y_m, width_m, depth_m, rotation_deg, icon?, height_m?,
            time?, sun?, character?, camera_id? }],
  windows: [{ id, wall_id, wall, facing: { bearing_deg, point } | null, missing, zone, hours: [{ from, to,
              altitude_deg?: { min, max } }] | null }],
  windows_note, left_out }
```

- `level` is the plan an item sits in: `room`, `blocking` or `setup`. x runs right and y down the plan; a rotation is
  clockwise from up the plan; `north.plan_rotation_deg` is where north points, clockwise from up the plan; a bearing
  is clockwise from north.
- A camera's field of view is the app's (src/core/model/fieldOfView.ts): the lens of its shown frame (else its own),
  the body's mode de-squeezed and turned when on its side, the project's frame shape fitted inside. `missing` says what
  it lacks (`noBody`, `noSensor`, `noFocal`).
- A sun path's `sun` is the app's reading (src/core/model/sunSources.ts): `place` and `date` with their `source`
  (`location`, `own`, `photo`; `shootDay`, `own`, `photo`), the `zone`, the sun `at` the item's time (`bearing_deg`,
  `altitude_deg`, `up`), at `solar_noon`, `sunrise`, `sunset`, golden and blue hour; or `missing` (`noFrames`, `noDay`,
  `noDate`, `noLocation`, `noPlace`, `noNorth`, `noZone`). No coordinates; bearings and altitudes (the sun's, a
  window's facing and its hours') are whole degrees.
- A window's hours are the app's (src/core/model/windowSun.ts): for a window in an outside wall, its facing and the
  stretches of direct sun on that date. Buildings and trees outside aren't known.

### list_suggestions

`{ project, status?, include_trashed? }`: `pending` (the default), `approved`, `rejected` or `all`. → `{ status,
suggestions: [{ id, kind, status, target: { id, type, label }, source, author: { name, role }, note, suggested_at,
decided_by, decided_at, data, fields_left_out, flags: [{ kind, words }], can_apply, trashed? }], note }`. Each is read
by the app's own reader (`reviewSuggestion`); `data`'s fields are given or left out by the target's type (its real
type when the target is in the project), every value scrubbed, and `fields_left_out` names those left out that are
known props (a suggested phone number, say) and counts the rest (`"2 unknown fields"`). A person applies each one in
the app.

Round 3: a suggestion from an assistant's change file (`created_by: "mcp"`, its `source` `mcp`) comes back without its
values, its note or its author: `{ id, kind, status, target: { id, type, label }, source, suggested_at, decided_at,
fields, flags: [{ kind, words }], can_apply, trashed? }`, its `label` made from the project's records ("SC 12 · 12B",
"Call sheet, Day 1 · …", "New frame in SC 12") through the view and the guard, never the label the file gave, and
`fields` the names of its fields that are known props of the target's type, the rest counted. What the assistant sent
it holds already; a value read back after the app stored it could say which of its guesses the project holds. For
the same reason its `flags` never hold `no_change` (round 4): whether the project already reads as suggested would say
what a hidden value is, and Apply stays open either way. Round 5: such a suggestion is reviewed for its flags alone
(`reviewSuggestion`'s `flags` mode), without working out the edit Apply would make, so the flag is never made and the
work done (and so the time taken) never depends on whether a value it sent is the one stored; `can_apply` is whether
it is pending with every flag one a person may apply over, as the full review gives it.

### run_checks

`{ project }` → every check over the project, from the function the app's Project checks tile runs (`allChecks`,
src/core/checks/allChecks.ts), in the tile's own words (English):

```
{ findings: [{ id, kind, check, words, day: { id, number, date } | null,
               target: { kind: "frame", frame: { id, number }, scene: { id, number } }
                     | { kind: "plan", scene, setup: { id, number }, item_ids }
                     | { kind: "location", location: { id, name } }
                     | { kind: "call_sheet", day } }],
  skipped: [{ id, kinds, reason, words, day, location: { id, name } | null }],
  old_forecasts: [{ id, day, location, fetched_at, words }],
  note }
```

An unavailable person's words name the day they're called and the dates of their stretch ("Robin Vale is called on
Day 1 · Sat, Nov 16 but marked unavailable Nov 16"). `kind` is one of `unavailable-on-day`, `gear-not-on-day`, `golden-hour-midday`, `exterior-rain`,
`location-missing`, `department-missing`, `hmu-too-short`, `plan-lens-differs`; `reason` one of `no-zone`,
`no-place`, `no-forecast`, `forecast-not-covering`, `forecast-not-hours`, `no-date`. The rain check reads only the
forecasts the project already holds (its cache in the file): the server never fetches one. No zone is looked up: a
location with its time zone typed is read in it, one with none typed has its light and rain skipped (`no-zone`),
never read in the zone of the computer the server runs on. An old forecast's words leave out when it was fetched (the
time would be this computer's); `fetched_at` is UTC. Amounts are metric. The checks run on the records the assistant
view keeps (no Trash); only the words and targets above go out, every string through the free-text rule (round 2: a
phone typed in a location's, a person's or a gear item's name never comes back), then the guard as every answer.
Its findings match the Project checks tile's, except a location with no time zone typed, which the assistant reports
as skipped where the app would look its zone up.

### The propose tools

Each takes `project` and `note` (words for the person who reviews it, at most 2,000 characters), checks its
suggestions and writes them as one change file (The one write, above), and answers:

```
{ written: { folder, folder_made, change_file_id, suggestions },
  suggestions: [{ id, kind, target, says }], next }
```

Fields are named and valued as the app names and values them (the assistant's scope row,
src/core/model/suggestionScope.ts; docs/SBD_FORMAT.md "What a suggestion may touch"): a frame's `title`, `size`
(`EWS`, `WS`, `MS`, `MCU`, `CU`, `ECU`, `INSERT`), `lens_mm`, `t_stop`, `support`, `height`, `move`, `status`
(`have`, `need`, `source`), `action`, `dialogue`, `location_id`, `shoot_day_id`, `gear_ids`; a scene's `name`,
`int_ext`, `day_night`, `location_id`, `page_eighths`. Plain values are taken where a person would use them:
`location` (or `location_id`) by the location's name, `shoot_day` by a date or a day number, `gear` by the items'
names. Shot and scene numbers are never suggested: the project's own rule gives them.

### suggest_shot_changes

`{ project, changes: [{ frame: "12A", scene?, fields: { size: "CU", lens_mm: 85 } }], note? }`: an `update` for each
frame, its `before` the frame's values as read. A frame by its number; its scene too when two share it.

### suggest_new_shots

`{ project, scene?: "12", after?: "12B" | "start", new_scene?: { name, int_ext, day_night, location, page_eighths,
after?: "12" }, frames: [{ size, action, … }], note? }`: a `create` for each frame, in the order given, each after the
one before it; in an existing scene after the frame named, at the start, or (left out) at the end; or a `create` for
a new scene (after the scene named, else at the end of the board) with its frames under it.

### suggest_reorder

`{ project, moves: [{ frame: "12B" } | { scene: "12", note: 1 }, with after: "12A" | "start", or after_note: 2, and
to_scene?: "13"], note? }`: a `reorder` for each frame or note (a note by its number among the scene's notes, from 1);
a frame can move to another scene, a note only within its own. Each move takes `after` or `after_note`; one with
neither is refused in words.

### suggest_gear_for_day

`{ project, day: "2026-11-18" | "1", add?: ["SkyPanel S60"], remove?: ["Boom kit Sennheiser"], note? }`: an
`update` of the day's gear list, items by name from the catalogue; added ones at the end, as the Gear picker adds them.

### suggest_call_sheet_notes

`{ project, day, notes?, safety_notes?, call_time?, wrap_time?, department_calls?: { sound: "06:30" },
person_times?: { "Sam Ortiz": { call?, hmu_ready?, on_set? } }, note? }`: an `update` of the day's call sheet (notes,
safety notes, department calls, people's times, a person by name), and one of the day itself for its crew call and
wrap. Times `HH:MM`; `null` clears one.

### suggest_trash

`{ project, items: [{ frame: "12A" } | { scene: "12" } | { scene: "12", note: 1 }], note? }`: a `trash` for each, never
a deletion; applied, it is the board's own move to the Trash.

## Later

- 7.7: `read_script` and `suggest_breakdown` (it needs the scene's breakdown lists, decision 9).
- With the room review: `suggest_room` (plan items join the assistant's scope row then).
- Settings → AI assistant's switch "Let the assistant read contact details" (decision 14) waits for a project prop
  Kevin hasn't approved; until it is built, these tools never send contact details.
- With departments by file: `get_room_reference`, `list_files`, `read_file` and `suggest_file_organization`, each
  obeying a file's flag (Read, Details only, Never).
- 7.10: local HTTP. Phase 8: the Claude Desktop bundle.

## The probe

Kevin's check (Phase 7 answer 1): does the Node inside Claude Desktop have `node:sqlite`? If it does, the Phase 8
bundle can use Claude Desktop's own Node; if not, the bundle carries its own SQLite reader. `mcp/probe/probe.mjs` is a
small server with one tool, `node_check`, which returns `process.version`, `process.versions.electron`, whether
`node:sqlite` loads and opens a file read-only (a small file it makes in a fresh folder of the system's temp space and
deletes after), and what the server needs of it as the probe finds them: `typeof` a statement's `setReturnArrays` and
`columns` (`"function"` from Node 22.16), and whether the `readOnly` option holds (a write on that connection is
refused). Errors come back by their codes only, never their messages, which can name a path. It needs no package, so
it runs as a bundle with `mcp/probe/manifest.json` alone.

Claude Desktop runs a bundle (.mcpb) on the Node it brings; a server in `claude_desktop_config.json` with `"command":
"node"` runs on yours. The question is about the first, so pack the probe as a bundle, a zip of its two files:

- Mac: in Terminal, `cd` to the repo's `mcp/probe` folder, then `zip storiiboard-probe.mcpb manifest.json probe.mjs`.
- Windows: in PowerShell, in `mcp\probe`, `Compress-Archive manifest.json, probe.mjs storiiboard-probe.zip`, then
  rename the zip to `storiiboard-probe.mcpb`.

Open the `.mcpb` (or drag it onto Settings → Extensions), install it, and in a chat ask Claude to run `node_check`.
Note the `node`, `electron`, `sqlite`, `set_return_arrays`, `columns` and `read_only_option` it says, on the Mac and
on Windows; then remove the extension. Leave the `.mcpb` out of the repo (`.gitignore` has `*.mcpb`). The manifest's format is the one Claude Desktop's bundles used on Nov 21; if Claude Desktop
refuses it, say what it says.

For a quick look with your own Node instead (not the question, but it shows the probe works):

```json
{
  "mcpServers": {
    "storiiboard-probe": { "command": "node", "args": ["/Users/robin/Code/storiiboard/mcp/probe/probe.mjs"] }
  }
}
```
