# The MCP server

Storiiboard's MCP server lets an AI assistant (Claude Desktop, Claude Code, any MCP client) read a project: its scenes,
frames, schedule, call sheets, people, gear, locations, bird's-eye plans and suggestions. Built in 7.5 (Phase 7,
docs/PHASE7_DECISIONS.md decisions 1, 2, 3, 14, 15 and 16). It reads only; it never changes the project.

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
of them when a call names only the shared name. It never tells the assistant a folder's name, which can name a person
or a client.

Quit Claude Desktop and open it again; the ten Storiiboard tools are listed under the tools button.

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

## What is never returned, and why

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
  fields are never read at all (above). The rule reads the text Unicode-aware: format characters (`\p{Cf}`: zero width
  spaces, soft hyphens) are dropped and the text normalised (NFKC), so full-width digits or a "＠" read as plain ones.
  Then, replaced with `[contact left out]`:
  - map links, with everything after them: `maps.google.`, `google.<tld>/maps` (`www.google.com/maps/…!3d…!4d…`),
    `goo.gl/maps`, `maps.app.goo.gl`, `share.google`, `maps.apple.`, `openstreetmap.org`, `osm.org`, `waze.com/ul`,
    `bing.com/maps`, what3words (`///word.word.word`, `w3w.co`), and plus codes (`849VCWC8+R9`, with a letter in
    them);
  - emails, with an `@` or a lookalike: `＠`, `(at)` or `[at]`, ` at `, an `@` with a space on both sides, and ` dot `
    or `(dot)` for a dot (`name at example dot com`). A handle (`@harbor.lights`) stays;
  - coordinate pairs (two decimals of 4 or more places, a latitude within 90 and a longitude within 180, so frame
    rates such as `23.976, 29.970` stay) and degrees-minutes-seconds;
  - phone numbers: 7 or more digits (any script's) in groups joined by a space (any `\p{Zs}`), two spaces, any dash or
    `−`, a dot, a slash, `·`, or a dash with a space each side; a letter right against the digits doesn't stop one
    (`Robin555-0123`). A phone has a leading `+` or `(`; or is one run of 10 or more digits, or of 9 starting with 6
    to 9 (`612345678`); or two groups, the first of 3 digits or fewer or starting with 0, the last of 4 or more
    (`555-0123`); or three or more groups ending in one of 4 or more, or of 9 or more digits starting with 0
    (`06 12 34 56 78`, `0475 12 34 56`), or 3-3-3 starting with 6 to 9 (`612 345 678`). Never a date (`2026-11-18`,
    `18.11.2026`, with or without a time after it), two groups whose first has 4 or more digits and doesn't start
    with 0 (night hours `1830-0630`, `2026-004512`), a range (two groups joined by a dash, the second 0 to 999 above
    the first: `993-1104`), or other groups whose last has under 4 digits (`101 102 103`, `1 250 000`). Ids are never
    touched.
  - Text in which nothing is taken out comes back exactly as stored, not normalised. Every pattern's start is anchored,
    so one very long word can't make the rule slow (100 KB of one word is read in well under 100 ms).
- **Suggestions' data**: each field is given or left out by the type of the record the suggestion acts on (its real
  target's type when the target is in the project), every value through the free-text rule; `fields_left_out` names a
  field only when it is a known prop, and counts the rest ("2 unknown fields"); its `type`, `parent_id` and `after_id`
  only as text of at most 100 characters, or null. Its kind, target type and source are scrubbed and kept to 64
  characters.
- **Files**: no picture, video, PDF, link or script, and no file path. A frame says only whether it has a picture.
- **The Trash**, unless a call asks with `include_trashed: true`; each trashed item is then marked `trashed`.
- **Board items, sketches, settings presets and availability**: no 7.5 tool reads them.
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
replaces each it finds with `[contact left out]`, as the rule above does; it never refuses an answer. It reads only
strings that hold typed text: never a key, an id, a number (a plan's positions are numbers), a date, a slate number, or
a name the view gives (a person's, a location's, a scene's, a company's, a room's, a character's). What it looks for,
both sides normalised (NFKC, case-folded, whitespace collapsed, format characters dropped):

- each phone-shaped part of a stored phone field (`555-0123 / 555-0199` is two; an `x 45` tail left out), and each
  phone number typed in left-out text (a person's notes, a location's notes, own fields' values), by its last 7
  digits, against every run of digits in a text string, with ids and ISO dates and date-times blanked first (so
  `555–0123` with an en dash, `5 5 5 0 1 2 3`, or full-width digits are caught);
- a stored email, and a stored address whole;
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

## Later

- 7.6: `run_checks` (the checks in src/core/checks) and the propose tools, which write suggestions as a change file
  beside the project, never into it (decision 3).
- 7.7: `read_script`.
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
