# Storiiboard 2.0 — Program Plan

Source: "Storiiboard 2.0 — Program Plan & Claude Code Hand-off" (PDF, Oct 31, 2026, Kevin Matos), kept unchanged at the repo root.
CLAUDE.md holds the working rules. This file holds scope, phases, gates and status.

## Status

| | |
|---|---|
| **Current phase** | **Phase 5 · Canvas flow**: Kevin answered Nov 10 and said go (docs/PHASE5_DECISIONS.md); 5.0 built (#136, waiting for Kevin's baseline comparison), 5.1a (#137), 5.1b (#138), 5.2 (#139), 5.3 (#140), 5.4 (#141), 5.5 (#142), 5.6a (#143), 5.6b (#144) and 5.7 (#145) built: every milestone built and reviewed, merged into `v2` Nov 13 (#135 to #145); the gate is Kevin's. **Phase 6 · Bird's-eye view** is planned and waits for his answers (#150). **Phase 4 · Call sheets**: built Nov 10, 4.0 to 4.13 (Kevin's follow-ups 4.11 to 4.13 included), merged into `v2` Nov 10 (#120 to #134); the gate is Kevin's |
| Phase 0 state | **Done.** Gate passed on the installers, Nov 2 (Mac: every step; Windows: create and double-click) |
| Branch | `v2` |
| Planned start | Nov 2, 2026 |
| Last updated | Nov 13, 2026 (Phase 5 merged, #135 to #145; Kevin's Nov 11 answers built, #146 to #149 open; Phase 6 planned, #150, waiting for his answers; models changed) |

| Phase | State |
|---|---|
| 0 · Foundation and .sbd | Done (Nov 2) |
| 1 · Storyboard | Built and polished; the gate is Kevin's |
| 2 · Video and images | Built (Nov 7); the gate is Kevin's |
| 3 · Production data | Built (Nov 9), follow-ups merged (Nov 10); the gate is Kevin's |
| 4 · Call sheets | **Built** and merged (Nov 10, #120 to #134); the gate is Kevin's |
| 5 · Canvas flow (moodboards and decks) | **Built** (Nov 11): #136 to #145 stacked, waiting to merge (#136's baselines need Kevin); the gate is Kevin's |
| 6 · Bird's-eye view | Planned (Nov 13): the milestones below and `docs/PHASE6_DECISIONS.md` wait for Kevin's answers; nothing built |
| 7 · AI assistant | Not started |
| 8 · Cloud links and release | Not started |
| 9 · Web companion | Not started |
| 10 · 3D set and Blender | Not started |

### Phase 6 milestones

Plan written Nov 13, 2026, from "Phase 6 notes" (Kevin, Nov 3) and CLAUDE.md's bird's-eye rules: a top-down plan in
real units per scene setup, on Phase 5's canvas core, in the Setup section. **Nothing is built until Kevin answers**
`docs/PHASE6_DECISIONS.md` (16 questions, each with a recommendation); the milestones below assume the
recommendations and change with his answers. Then as Phases 4 and 5 were: built by the builder from briefs, one PR per
milestone into `v2`, reviewed until nothing high or medium is left. No new dependency is planned. The schema change
(decision 16: props only, one version) waits for his approval. The gate: a gaffer plans a real setup with it.

| Milestone | Scope | PR | State |
|---|---|---|---|
| 6.0 Setups | `setup` records under a scene, lettered; frames join one from the board or the Setup section (`setup_id`; Shoot days' totals already count them); the Setup section goes live and lists setups by scene; the Trash and History (decision 3) | | Not started |
| 6.1 Bodies and lenses | Camera bodies in Gear with the sensor size of the recording mode, from a table with sources, and A/B letters (decision 4); lenses in Gear with focal range and squeeze; a frame picks its lens, `lens_mm` kept inside the range (decision 5); the schema version (decision 16) | | Not started |
| 6.2 The plan in real units | The canvas core given a scale in metres: grid, rulers, a scale bar, lengths typed in metres or feet (decision 7); a plan per setup over the scene's room (decision 2); walls drawn point to point with typed lengths, doors and windows that sit in a wall; paper in both themes (decision 13) | | Not started |
| 6.3 The library | The 68 plan icons as items with real sizes, by department: set pieces, grip, sound, production (decision 8); the Library tile, drag or keyboard to place | | Not started |
| 6.4 Cameras | A camera with its body and its frames; the field of view drawn from the picked frame's lens, sensor width and squeeze, live (decision 6); the Frames tile under the plan; camera height kept (decision 11); the lens check in src/core/checks | | Not started |
| 6.5 Lights, flags and diffusion | Fixtures with a beam cone and height, flags and frames at real sizes, each optionally the `gear_item` it is, so the day's gear check covers the plan (decision 8) | | Not started |
| 6.6 Cast and moves | A mark per character with numbered positions and paths; camera moves and dolly track with real lengths (decision 9) | | Not started |
| 6.7 Layers | The Layers tile: show, hide, dim and lock per department; a person starts on their own (decision 10) | | Not started |
| 6.8 Underlay and measure | A floor plan or photo underneath, set to scale by two points; the measure tool (decision 12) | | Not started |
| 6.9 Export | A setup's plan as PDF and PNG: to scale, with scale bar, legend, frames and lenses (decision 14) | | Not started |
| 6.10 Performance | 300 items at 60 fps, measured (decision 15) | | Not started |
| Phase 6 gate | A checkpoint and Kevin's checklist: a gaffer plans a real setup | | Not started |

Not in Phase 6: the 3D set and Blender (Phase 10, which reads these plans and their heights), the plan on the web
(Phase 9), plans read by the MCP (Phase 7), the plan on the call sheet (a later follow-up).

### Phase 5 milestones

Plan written Nov 10, 2026, from "Phase 5 notes" (Kevin, Nov 5): moodboards and decks merge into one canvas flow, like
Figma and FigJam. Kevin answered Nov 10 and said go: `docs/PHASE5_DECISIONS.md` (1, 5, 6 and 8 to 13 as
recommended; 2, 3, 4 and 7 with his changes). Built by the builder from briefs, one PR per milestone into `v2`,
reviewed until nothing high or medium is left, as Phase 4 was. Approved: font-kit 0.14.3 (Rust, MIT or Apache-2.0);
anything else new, or any other change to existing data, waits for Kevin. The gate: a deck built in under an hour, for
a real pitch.

| Milestone | Scope | PR | State |
|---|---|---|---|
| 5.0 The canvas core | react-konva canvas shared with Phase 6 (decision 11): pan, zoom (wheel, pinch, keys), a minimap, selection (click, shift, marquee), move, resize, rotate, z order, copy and paste, delete to the Trash; every change an op (decision 1); the Moodboard section lists boards (decision 2): a department's board is created the first time it's opened, + makes more | #136 | Built Nov 11, stacked on #135; two review rounds; rectangles as the one item; changes all 60 baselines (Moodboard no longer "coming"; "By this computer's region"), waiting for Kevin |
| 5.1 Items | Text boxes in the bundled fonts and this computer's, listed through font-kit (decision 7: Adobe Fonts checked on a Mac and on Windows; a font this computer lacks shows its fallback and says which), sticky notes, shapes in any colour; pictures dropped or pasted, stored as frames' are, at most 2560 px with a pointer to the original, never the original embedded (decision 4); video cards with a still (decision 5); links | #137 (5.1a) | 5.1a built Nov 11 (text, stickies, shapes, colour, fonts), stacked on #136; three review rounds; board content never themed (missing colour is ink, the canvas is paper in both themes: decided by default, Kevin's review). 5.1b built Nov 11 (#138: pictures, video cards, links), stacked on #137; three review rounds; "Show original" left out (opening a file the app didn't write waits for Kevin) |
| 5.2 Connectors | Straight, bent or curved, arrowheads and labels, snapping to items and moving with them; quick-create a connected item | #139 | Built Nov 11, stacked on #138; two review rounds; elbows up to five segments; a connector trashed with its item comes back with it; quick-create Cmd+Option+arrow, Ctrl+Shift+arrow on Windows |
| 5.3 Sections and layout | Sections that group items and move with their contents; Tidy up (rows, columns, grid), align and distribute, snap guides | #140 | Built Nov 11, stacked on #139; one review round; section contents worked out, never stored; Alt (Option) keys |
| 5.4 Live cards | Shots and scenes from the storyboard as live cards (decision 6) that jump back to the board; scene palettes; brand-kit cards from the company profile (colours, fonts, logo); links of a board to scenes, characters and locations | #141 | Built Nov 11, stacked on #140; two review rounds; brand colours and fonts on company profiles; a context menu on frames and scene headings (Add to board...); palette hex copied from the strip |
| 5.5 Decks | Page frames on a board (decision 3: 16:9, 9:16 and 4:5 for social decks, A4 and Letter for a treatment), ordered; Present; four templates filled from the project (decision 8) | #142 | Built Nov 11, stacked on #141; two review rounds; live field cards (names and roles only, never contact details); Present over the window, nothing reaches the project while it's up |
| 5.6 Export | Deck PDF (pdf-lib: text as text in its font, embedded only where its `fsType` bits allow, else the fallback and the export says so; pictures at full quality from their originals) and PNG per page (Konva); scene palettes from a moodboard, swatches as a PNG strip and Adobe .ase (decision 9) | #143 (5.6a) | 5.6a built Nov 11 (deck PDF and PNGs), stacked on #142; two review rounds; originals read through Rust (src-tauri/src/originals.rs) and checked against the stored copy; variable fonts that can't print a weight use Inter Tight (static instances wait for Kevin). 5.6b built Nov 11 (#144: palettes from a board, swatches as PNG and .ase), stacked on #143; one review round; also fixed the desktop refusing .json exports since Phase 2 |
| 5.7 Performance | The 500-item board (decision 12): drawing only what's in view, small previews when zoomed out and the full picture only up close (decision 4), a test like Q2's | #145 | Built Nov 11, stacked on #144; one review round; p95 16.7-16.8 ms for pan, zoom, drag and marquee on the 500-item board (Chromium, dev build; was 33-67 ms); to check on Kevin's Mac and a mid Windows laptop |
| 5.8 Kevin's Nov 11 answers, the small ones | The tests' server opens no socket to the page (Vite's client connected even with hot reload off, which 5.2 had already set; its refusals were the dev-server flake), with no console error filtered; 4.7's Spanish stamp says "Actualizada", not "Revisada"; the builder's foreground line; the opener rule for Show in Finder / Explorer in CLAUDE.md | #146 | Built Nov 13 by the main session (small); the new test fails without the change (two `ws://localhost:1421` sockets seen) |
| 5.9 Show in Finder / Show in Explorer | Kevin's Nov 11 answer to 5.1b: a board picture's recorded original shown in its folder, through the opener's reveal only, never opened, and only when the file exists | #147 | Built Nov 13; two review rounds; Rust finds the path from the picture's own `media` record (not in the Trash, a picture's file name), by metadata alone, so a click never downloads an online-only file; the page names no path and has no new permission; the real reveal and the Mac's folder prompt are for Kevin's by-hand pass |
| 5.10 Every weight of the bundled fonts | Kevin's Nov 11 answer to 5.6a: a deck's PDF prints Inter Tight, JetBrains Mono, Archivo, Bodoni Moda, Jost and Outfit at every weight a board can give them, from the static files their publishers ship (SIL OFL), each pinned to a commit with its SHA-256 in src/features/export/fonts/README.md | #148 | Built Nov 13; one review round; 91 files, none padded, none generated (fontTools 4.68.0 by hand, only to check); 17.6 MB more in the repository and the app, loaded only when a PDF needs them; the storyboard and call sheet PDFs' text didn't move (0.000 pt over eight PDFs; one pinned hash renewed); static and variable advances agree within 0.06%; Bodoni Moda's publisher ships one optical size (11), so its large text prints about 2% wider than the canvas draws it: Kevin's call |
| 5.11 The sidebar's built sections | Kevin, Nov 11: Storyboard, Assets, Team and Production no longer show a phase, muted; only Setup does, until Phase 6 | #149 | Built Nov 13 by the main session (small); all 60 baselines regenerated, waiting for Kevin's comparison |
| Phase 5 gate | A checkpoint and Kevin's checklist: a deck built in under an hour | | Not started |

Not in Phase 5: comments and boards on the web (Phase 9), the bird's-eye view (Phase 6, on the same core), AI-made
images (never: Phase 7 writes prompts only).

### Phase 4 milestones

Plan written Nov 9, 2026; Kevin answered and said go the same day: 4.0, 4.1 to 4.8, 4.9, 4.10, in that order, stopping
at the gate. His answers, one page: `docs/PHASE4_DECISIONS.md`. One PR per milestone into `v2`, each with its tests,
reviewed until nothing high or medium is left, under the same rules as Phase 3, built by the builder from briefs
(CLAUDE.md, Workflow). Approved: SunCalc, qrcode-generator, tzf-rs (Kevin, Nov 10, in place of @photostructure/tz-lookup), and the hosts for the service
switch file, api.met.no and tile.openstreetmap.org; anything else new, or any other change to existing data, waits
for Kevin. The gate: a call sheet used on a real shoot day.

| Milestone | Scope | PR | State |
|---|---|---|---|
| 4.0 Service switch | A JSON file in this repo, read through net.rs at most once a day just before an online service is used: a service turned off (with a message where it's used) or moved to another server on the code's list, never a new host; the last copy, then the code's defaults, when unreadable. Settings lists every online service, what for and when; the README's section for service operators. Tests use a fixture (decision 0) | #120 | Built Nov 10; two review rounds; Settings baselines (the new tab) approved by Kevin, Nov 10 |
| 4.1 The call sheet | A Call sheets tile in Production: pick a shoot day, see its call sheet built live from the project: the day (number, date, crew call, wrap), its locations, its scenes in order (heading, pages, characters and who plays them), crew by department; notes of its own (general, safety); a `callsheet` record per day holding only what it adds | #121 | Built Nov 10, stacked on 4.0; two review rounds; notes private in History |
| 4.2 Who and when | Who's on the day (decision 9); crew call per department and per person where it differs; cast call, HMU ready and on-set times (decision 6); contacts only for the people on it | #122 | Built Nov 10, stacked on 4.1; three review rounds |
| 4.3 Sun times | Sunrise, sunset, golden and blue hour for each location, offline, from its place on the map and the date (decision 3), in the location's time zone (decision 7) | #123 | Built Nov 10, stacked on 4.2; three review rounds; tzf-rs in Rust (Kevin, Nov 10); high latitudes show merged golden and blue stretches |
| 4.4 Weather | The day's forecast at each location from MET Norway (decision 1), through net.rs, only when a call sheet is opened or refreshed, cached in `lookups` with when it was fetched, never asked again before `Expires`; units by region with a Settings override; the fetch time on the sheet; not yet available beyond the forecast's range; credited | #124 | Built Nov 10, stacked on 4.3; two review rounds; If-Modified-Since on renewals; Settings baselines (Weather units) approved by Kevin, Nov 10 |
| 4.5 Nearest hospital | Find nearest hospital on a location (decision 2): Nominatim, up to five by straight-line distance, emergency departments first, a note on the others; one picked is kept on the location, editable by hand, and printed on every call sheet there; the emergency number by country | #125 | Built Nov 10, stacked on 4.4; three review rounds; boxes 10 km then 50 km (not 25/75), real hospitals only |
| 4.6 The PDF | The call sheet as a PDF (pdf-lib, already in the build), Letter or A4 (decision 8), in the app's look, every word translated; the map as address, coordinates, link and QR (decision 4), directions in the app chosen in Settings | #126 | Built Nov 10, stacked on 4.5; two review rounds; tappable links; Settings baselines (Directions open in) approved by Kevin, Nov 10 |
| 4.7 Issuing | Issue: the PDF kept as sent, the version and issue time in its header ("Revised" from version 2), the day's scenes' shot numbers locked in the same step (Phase 4 notes); "Changed since issued" after (a new forecast doesn't count); re-issue as version 2, 3… (decision 5) | #127 | Built Nov 10, stacked on 4.6; three review rounds; a frozen fingerprint recipe per version |
| 4.8 Call sheet checks | src/core/checks: a location missing its address, contact or parking note; a department missing that a scene needs (sound on dialogue scenes); HMU too short before a cast member's call; a golden-hour scene (DAWN, DUSK, MAGIC HOUR) scheduled at midday; an exterior on a day with rain forecast. Shown on the call sheet, as 3.9b's gear check is | #128 | Built Nov 10, stacked on 4.7; three review rounds; checks say which they skipped (for the MCP); the department rules approved by Kevin, Nov 10 |
| 4.9 The map on a location | react-konva, tiles through Rust with a disk cache under OpenStreetMap's tile policy (User-Agent, credit always visible, cache headers or 7 days, only the tiles in view, no offline download); a provider of one's own in Settings adds that one host, said so there; the pin dragged to where the crew should go saves the location's place | #129 | Built Nov 10, stacked on 4.8; three review rounds; the tile-server question is a native message dialog from Rust (Kevin's OK, Nov 10: only to confirm a new host); keys for one's own tile server later |
| 4.10 The map on the call sheet | The map image on the call sheet (decision 4b), from the tile cache, with the credit | #130 | Built Nov 10, stacked on 4.9; three review rounds; the map composed into one JPEG per location (canvas fallback for macOS 13.0–13.2) |
| 4.11 Only frames to shoot | Kevin's Nov 10 answer to #121: the call sheet lists only Need-to-shoot frames; Have and Source drop off the sheet (scenes, locations, cast, checks, PDF, issuing follow); the Calendar keeps showing them | #131 | Built Nov 10, stacked on 4.10; one review round |
| 4.12 The company on the header | Kevin's Nov 10 answer to #126: the call sheet's header prints the project's company name and logo when one is attached, with the title | #132 | Built Nov 10, stacked on 4.11; two review rounds; the logo redrawn in sRGB for print |
| 4.13 Ambulance numbers | Kevin's Nov 10 answer to #125: ambulance-only numbers labelled Ambulance; the other Latin American countries added, each from an official government source | #133 | Built Nov 10, stacked on 4.12; checked by the main session against its sources; Bolivia left out (168 isn't national), "check locally": the table accepted by Kevin, Nov 10 |
| Phase 4 gate | A checkpoint and Kevin's checklist: a call sheet used on a real shoot day | | Not started |

Not in Phase 4: cast availability (Phase 9, from the web), sending call sheets (publishing is Phase 9), driving times
to the hospital (a routing service), US weather alerts (NWS, later).

### Phase 3 milestones

Plan written Nov 7, 2026, under Kevin's queued rules (docs/HANDOFF.md): additive format changes go ahead, each with
a migration, a backup first and tests; anything easy to undo takes the recommendation, marked "decided by default,
review"; anything that alters existing data or adds a dependency waits. The decisions, one page:
`docs/PHASE3_DECISIONS.md`. One PR per milestone into `v2`, each with its tests, reviewed until nothing high or medium
is left. The gate: a real shoot's people, places and gear are entered.

| Milestone | Scope | PR | State |
|---|---|---|---|
| 3.1 Project details | Logline, format, runtime, stage (Notion's pipeline, apart from state), client contact, deliverables checklist; the Project panel | #88 | Done |
| 3.2 Company profiles | Saved once in app settings; attaching one copies its details and logo into the .sbd, with Update from profile | #89 | Done |
| 3.3a Locations | The Locations tile: list and editor (address as text, contact, parking and power notes, status), its scenes, Copy map link, the Trash | #90 | Done |
| 3.3b Locations, the rest | Photos, custom fields, a frame's location over its scene's | #91 | Done |
| 3.4 Address search | Search (never autocomplete) through Rust to Nominatim, 1 request a second, the app in the User-Agent; every result cached in the .sbd (`lookups`, a schema bump) | #106 | Done |
| 3.5a Cast and crew | The Cast and crew tile: people with departments, a role, a title and contacts (private: never logged or shown in History), their own fields, the Trash | #92 | Done |
| 3.5b Characters and Team | Characters linked to cast; the Team section | #93 | Done |
| 3.5c You in Cast and crew | Pick yourself in Cast and crew in place of the local project role (decision 4; split from 3.5b, decided by default, review) | #94 | Done |
| 3.6a Department workspaces | Open a department's workspace from its row on a frame: its view of the frame and the scene, listed in the sidebar until taken off | #95 | Done |
| 3.6b Approvals per scene | The director or DP approves each department per scene; Seen, Working on it and Done stay per frame; "Changed since approval"; migration 9 carries a frame approval to its scene only where every frame had it (Kevin, Nov 9) | #96 | Done |
| 3.6c Perspective views | Full view per person in Cast and crew (on by default for the director and DP); everyone else sees their own department first, the rest folded under Rest of crew (Kevin, Nov 9) | #97 | Done |
| 3.6d Manage workspaces | Custom workspaces (save a layout as one, rename, duplicate, delete) and the Manage workspaces… window (deferred from Phase 1) | #98 | Done |
| 3.7 Shoot days | The Days tile: days with date, call and wrap, "Need to shoot" frames moved in and between days (one undo step each), totals computed (shots, setups, estimated hours) | #99 | Done |
| 3.8 Calendar | The Calendar tile: month and week, the schedule list, a picked day narrowing it, each day's scenes, location status and crew confirmed; in Production's default layout | #100 | Done |
| 3.9a Gear catalogue | The Gear tile: the project's gear (name, department, quantity, owned or rented and from whom, day rate), the project's currency, the Trash (split from 3.9, decided by default, review) | #101 | Done |
| 3.9b Gear per day | A gear list per shoot day and gear linked to frames, from the catalogue; the first consistency check (src/core/checks): a frame's gear not on its day's list | #102 | Done |
| 3.10 Notifications | The History feed with read and unread per person (schema bump, not an op), the unread count in the status bar, filters All, Unread and this scene, Mark all read | #103 | Done |
| 3.11 Assets and attachments | The Assets section: PDFs (stored, capped) and links on frames, scenes, locations and people (schema bump) | #104 | Done |
| Phase 3 gate | A checkpoint and Kevin's checklist: a real shoot's people, places and gear entered | | Reached Nov 9: checkpoint passed (`checkpoint/phase3-gate`, every job); the checklist is Kevin's |
| 3.12 Opening links and files | Tauri's opener plugin, only for http and https links and files the app saved itself (a PDF to a temp copy first); never anything else, executables especially (Kevin, Nov 9) | #107 | Done |
| 3.13 Characters as ids | A scene's character list becomes character ids: names matched to character records (trimmed, case-insensitive), missing ones made; a migration that alters data, backup first (Kevin, Nov 9) | #108 | Done |
| 3.14 Project data or Full archive | The JSON export's two choices: Project data (the default) leaves out the Trash and History; Full archive carries both; both import back without loss (Kevin, Nov 9) | #109 | Done |
| 3.15 Approvals by what a department touches | Shared fields (picture, sketch, action, dialogue, shot size, lens, movement) change every department's approval; a department's own notes and ticks change only its own (Kevin, Nov 9) | #110 | Done |
| 3.16 Approvals on the board | A small marker on each scene heading: how many departments are approved, and a dot when any shows "Changed since approval" (Kevin, Nov 9) | #111 | Done |
| 3.17 The week's first day | From this computer's regional settings in every language, with a Sunday or Monday override in Settings (Kevin, Nov 9) | #112 | Done |
| 3.18 Approvals, kept through upgrades | T-stop, support and height count for camera and grip-electric; the scene's characters for every department; an approval current before an upgrade (of the format or of the rule) stays current after it, 3.13's false "Changed" cleared where it can be (Kevin, Nov 9) | #116 | Done |
| 3.19 Failed tests by name | Every failed test's name saved: Playwright's retries report flaky ones, Vitest writes a report, both kept as CI artifacts and listed in each report; grab-a-still's cause found if it fails again (Kevin, Nov 9) | #117 | Done |

Kevin's Nov 9 answers: the address search approved (one shared HTTP client, rustls, pinned, fixed hosts); the opener
plugin for links and saved files only; a map with Leaflet and raster tiles under the OpenStreetMap tile policy, the
provider switchable in Settings (the map waits for one question back: docs/HANDOFF.md, "Map: before building"); scene
characters as ids, data change approved; the JSON export's two choices; the approvals changes; the week's first day.
Every other default from the overnight run is approved. After 3.17: the Phase 4 plan and decision sheet, not its build.

3.19 as built (Nov 9): failed tests by name (`scripts/failedTests.ts`, `npm run failed-tests`).
- Vitest writes a JSON report beside its usual output (test-results/unit.json), Playwright one beside its own
  (test-results/e2e.json); Playwright's output folder moved to test-results/e2e, since it empties that folder as a run
  starts and would take Vitest's report with it.
- `npm run failed-tests` lists every failed test by file and title, and every flaky one (Playwright passed it only on
  its retry, which CI allows once): from the last local run, or from report files named on the command line (a CI
  artifact). It says so when none failed, and fails when a report is missing or unreadable, so no report never reads
  as a clean run.
- CI: the quick checks list failed unit tests in the log and keep unit-test-report; each checkpoint smoke job lists
  failed and flaky end-to-end tests and keeps e2e-test-report-linux or -macos, 14 days, whether the job passed or not
  (a flaky test leaves it green). Rust's tests stay in the log: Kevin named Vitest and Playwright.
- A run can fail with no test failed, and is listed then too: a Vitest file that didn't load or whose hook threw
  (a beforeAll skips its tests; an afterAll fails the file after they passed), and Playwright's errors outside every
  test (a spec that threw as it loaded, a test.only on CI, the web server, no tests found). Each report's start time
  is printed, since a rerun of one file rewrites the report. What it can't see: an error Vitest reports outside every
  file (an unhandled rejection) isn't in its report; a red `npm test` with nothing listed is that, in the log.
- `engines` is Node 22.18 or later, the first 22 to run TypeScript without a flag.
- Tests: the two report shapes as each tool writes them (a file that didn't load, a hook that threw, describe blocks,
  projects, flaky, skipped, errors outside a test), the start time, and a clean run; and a probe of each failure
  outside a test against the real reporters (in test-results/probe).

3.18 as built (Nov 9): approvals kept through upgrades (`src/core/model/sceneApprovals.ts`, schema 13,
`src/core/storage/migrations/013_approvals_kept.ts`).
- The rule (Kevin Nov 9): a new approval's fingerprint starts `3:`: 3.15's shared fields and the department's own
  notes and ticks, plus the scene's characters (`character_ids`, and what a name match left in `characters`) for
  every department, and each frame's T-stop, support and height for camera and grip-electric.
- Every approval is read by the rule it was given under: `3:` by 3.18's, `2:` by 3.15's (kept exactly, its
  fingerprint pinned in a test), no prefix by 3.6b's; a prefix this version doesn't know reads as changed. So a change
  of rule turns none "Changed": a 3.15 approval stays current when a T-stop or the cast changes. Given again, an
  approval takes the newest rule.
- Through a format upgrade: `approvalsKeptThrough(before, after, scene)` re-stamps every sign-off that was current
  before a migration and isn't after it, by its own rule, on the records after it. Schema 12 uses it now (its scenes'
  names becoming ids changed what 3.6b's and 3.18's rules read; schema 9, run today, stamps `3:`, which reads
  characters, so an old file's 9 then 12 needed it too).
- Schema 13 (the change to existing data Kevin asked for: "clearing the false ones on already-upgraded files"):
  for a file schema 12 upgraded before it re-stamped, it finds schema 12's own step for each scene in History (names
  before, ids after), reads the scene with its old characters back, and re-stamps the sign-offs current then. A
  sign-off changed for another reason, or a scene whose characters were edited since, stays as it is. One logged
  step, backup first; nothing to repair, no step.
- Tests: the new rule per department, each rule read by its own, the pinned fingerprints (3.6b, 3.15, 3.18),
  re-stamping by rule (a changed sign-off left changed), schema 12 alone keeping approvals of every rule current (and
  failing with the re-stamp off), schema 13 on a file upgraded by 12 as shipped.

3.17 as built (Nov 9): the week's first day (`src/app/weekStart.ts`, `src-tauri/src/region.rs`).
- The Calendar's week starts on the day this computer's regional settings say, in every language (it went by the
  language before: Sunday in English, Monday in Spanish). Settings → App has "Week starts on": as the region says
  (the default), Sunday or Monday.
- A webview knows the app's language, not the region's formats, so on the desktop Rust reads them: Windows' regional
  "first day of week" (GetLocaleInfoEx; `windows-sys`'s Globalization feature, a part of a crate already used, no new
  one), a Mac's first day from Language & Region (`defaults read -g AppleFirstWeekday`, else the region in
  `AppleLocale`). The page turns a region into a first day with Intl's week info, or CLDR's table where the engine
  has none, so a region that starts on Saturday does too. In a browser, the browser's language stands in.
- A Mac's region picked apart from its language (`en_GB@rg=uszzzz`, British English set to the US) counts as the
  region. Linux's `C` and `POSIX` name none.
- Decided by default, review: the setting is this computer's, as the language is; a region whose week starts on
  Saturday starts it there (the grid takes any day), though the override offers only Sunday and Monday, as asked.
- Tests: Rust (Windows' and a Mac's counting; a locale read as a page reads one; this computer read without failing);
  the region's first day (US, Mexico, Spain, Britain, Egypt), Settings over the region, the computer's own over its
  region, the setting kept and an unknown one read as the region's; end to end, the region's Sunday, Monday from
  Settings, and the region again in Spanish.

3.16 as built (Nov 9): approvals on the board (`ApprovalsMarker` in `src/features/storyboard/StoryboardView.tsx`,
`sceneApprovalSummary` in `src/core/model/sceneApprovals.ts`).
- Each scene heading on the board, after its page count and frame counts, shows how many departments are approved
  (the Approved diamond and a count, as the Inspector marks Approved) and, when any shows "Changed since approval", a
  dot in the warning colour (paper on the dark theme) with the word "changed". The
  title says it on hover ("3 departments approved, 1 changed since approval"); a screen reader hears it in full, as
  part of the heading. A scene without approvals shows nothing, and isn't worked out.
- Decided by default, review: the word beside the dot (the warning colour alone is under 3:1 on the dark theme, and a
  dot alone is a colour-only cue); the count is departments approved by everyone who signed them (one current and one
  stale sign-off is changed); in a focus view it counts your departments alone, as the cards do; a department this
  version doesn't show isn't counted; the marker stays inside the heading, as the page and frame counts are.
- Tests: the counts (approved, changed, none); the marker's words, title and dot, the dot alone, nothing without
  approvals; one current and one stale sign-off read as changed; a department this version doesn't show isn't
  counted; a focus view counts its departments; the marker in the grid, strip and list; end to end, approving a
  department says one approved, a change shows the dot, undo brings it back. Looked at in light and dark.

3.15 as built (Nov 9): approvals by what a department touches (`src/core/model/sceneApprovals.ts`).
- Kevin's rule: the shared fields change every department's approval: each frame's picture (its stored file, how it
  sits in the frame, and the video clip it plays) and sketch, action, dialogue, shot size, lens and movement. A
  department's own notes and ticks (Working on it, Done) change only its own. Nothing else (T-stop, support, height,
  a title, custom fields, gear, the shoot day, note cards) changes an approval.
- Approvals given before keep the fingerprint 3.6b made, and are read by 3.6b's rule, so none turns "Changed since
  approval" because the rule changed; given again, an approval takes the new rule (its fingerprint starts `2:`). No
  stored data changes. But a file upgraded through schema 12 (3.13) with a script's scenes already shows its older
  approvals as changed: that upgrade rewrote the scenes' character lists, which 3.6b's rule counted. Approving again
  clears it, and from here character lists change no approval.
- Decided by default, review: the scene's heading (name, INT/EXT, DAY/NIGHT, location) and which frames it has, in
  order, count as shared (they're where and when every department works), and so does a frame's own location; a
  frame's crop and its video clip count as its picture; Priority still never counts; note cards no longer count;
  per-department notes don't exist yet (whatever a department keeps in its entry counts, for it alone); a LUT on a
  frame's video counts for no one. Say if a field should count for one department (T-stop and
  support for camera, say).
- Tests: each shared field changes every department's; a department's own notes and ticks change only its own;
  T-stop, support, height, a title, custom fields, gear, the shoot day and a note card change none; an approval from
  before reads by its rule, a new one by the new, and one given again takes the new (and never works out the old
  one); both rules' fingerprints pinned as literals; a clip and a frame's own location count; migration 9's carried
  approvals start current, by the new rule.
- Also fixed here: the Calendar dropped a key pressed while an arrow crossed into another month (the day pressed on
  wasn't in the new month's grid until the next frame, so a held arrow, or three quick ones, could lose focus to the
  page; the end-to-end test failed about one run in eight). Focus now moves as soon as the grid is drawn; the test
  passed 40 runs in a row.

3.14 as built (Nov 9): Project data or Full archive (`src/core/storage/projectJson.ts`,
`src/features/export/projectJsonFormat.ts`).
- Export has two JSON choices. Project data (JSON), the default, is the project without its Trash or History: no
  record in the Trash or under one (an erased sketch stroke too), no picture only those show, no steps, named versions, read state or
  cached lookups. Full archive (JSON) is everything, as 2.9's export was. Both import back with Import project data…
  as exactly what they hold (docs/SBD_FORMAT.md, "Project data as JSON").
- The JSON's header says which (`contents`); a file from before is a full archive.
- Decided by default, review: slate numbers stay in Project data (a number once on a slate is never given again);
  cached lookups are left out of it (a deleted location's address can be among them); the people in Cast and crew
  stay, contacts included, as they're the project's own records (the names left out are History's authors and
  who trashed what); the names on scene approvals stay, as they're what the scene shows now; Project data keeps 2.9's id (`project-json`), Full archive is new (`full-archive-json`).
- Tests: Project data leaves out a trashed frame, what's under it, its Seen and a picture only it shows; History,
  versions, read state and lookups come with no rows, and no one's name from History; slate numbers stay; imported,
  it exports again as the same file, with nothing to undo; a file from before reads as a full archive; the size
  estimate; end to end, both exported, Project data without the trashed frame or History, the Full archive imported
  with its Trash.

3.13 as built (Nov 9): scene characters as ids (schema 12, `src/core/storage/migrations/012_character_ids.ts`).
- Kevin approved the change to existing data. Each scene's character names (`characters`, from a script import)
  become `character_ids`: names matched to the project's live characters, trimmed and in any case; a character made
  for any name with none, so nothing a scene listed is lost. Scenes in the Trash too. One logged step in History,
  new characters among it; ⌘Z stops there, as after schema 9. The file is backed up first.
- A script import now lists a scene's characters by id: the project's own by name (any case), or those it makes.
  `sceneCharacters` reads a scene's live characters for the views and call sheets to come (Phase 4).
- Nothing on screen showed a scene's character names, so nothing on screen changes; History says a scene's characters
  as how many. A scene put back in the older shape (Restore to here, or a version opened from before the upgrade)
  reads its names as the upgrade matched them; a restore that keeps a scene as it is now keeps its characters.
- Decided by default, review: a character in the Trash isn't matched (a scene would read it as none), so a new one is
  made beside it; two live characters of one name, the first is used; a value that isn't a name stays in `characters`.
- Tests: the upgrade (backup; trimmed and any case; made for the missing; a trashed one not matched; twice is once; a
  value that isn't a name kept; a scene in the Trash; a project's own character keeps who plays it; places after every
  other), one step in History with its creates, ⌘Z stops, Restore to before it and back; matching within the scene's
  own project; the import's ids, an existing character reused whatever its case.

3.12 as built (Nov 9): opening links and PDFs (`src-tauri/src/open.rs`, `src/app/opener.ts`).
- Open, on each attachment in the Assets tile: a link in the browser, a PDF in the computer's PDF reader. Open map,
  in the Locations tile beside Copy map link: the pin (or a search for the address) on OpenStreetMap.
- Kevin's rule (Nov 9): only http and https links, and only files the app wrote itself. Tauri's opener plugin
  (`tauri-plugin-opener` 2.7.2, pinned exactly; MIT or Apache; it adds `open`, `is-wsl` and `is-docker`, all MIT) is
  used only from Rust: the page has none of its permissions, so two commands of our own are the only way to it.
  `open_link` takes an http or https address with a host and no name or password. `open_pdf` takes a PDF by its
  SHA-256 and the open project's handle: Rust reads the bytes from the .sbd itself, checks they start `%PDF-`, writes
  a read-only copy named `<name>.pdf` (the name made plain: no folder, drive, reserved character, leading dot or
  device name) into a folder of its own under the app's cache folder ("Opened PDFs"), and opens only that path. The
  page never names a path. On Windows the copy is marked as from the internet (Zone.Identifier), so the reader opens it
  in its protected view. Copies older than a day are tidied away as the app starts and when a PDF is opened, only
  folders this made.
- A browser build opens a link in a new tab and a PDF as the browser shows one (noopener).
- Decided by default, review: the copy is read-only (a change in the reader can't reach the project, and would be
  lost); every copy is marked as from the internet, the ones you attached yourself too, so Acrobat opens them in
  Protected View with its "Enable all features" bar; a day's keep for copies; Open sits first, before Save a copy and
  Copy link; a link with a name and password, or past 2048 characters, is refused when added, as Open refuses it.
- Tests: Rust (only web links, a list of what's refused: files, executables, javascript:, mailto:, smb:, ms-settings:,
  credentials; the copy's name always a plain `.pdf`; the copy read-only in a folder of its own; tidying only old
  folders of its own; the hash checked); a web link refused before anything is opened; end to end, Open on a link
  (a new tab, answered in the test) and a PDF, Open map at the pin.

3.4 as built (Nov 9): the address search (`src-tauri/src/net.rs`, `src-tauri/src/geocode.rs`, `src/core/net/`,
`src/features/locations/AddressSearch.tsx`).
- Search address, under a location's address in the Locations tile, looks up what's typed (the address, else the
  name) on Nominatim, only when pressed, never as it's typed. Up to five places come back with their coordinates;
  picking one puts it on the location (one ⌘Z): `latitude`, `longitude` and `map_name`, shown as "On the map", with
  Clear map place. The address stays as typed (an empty one takes the place's name); a new address takes the place
  off in the same edit (re-spacing doesn't), and results found for words since changed are refused. Copy map link
  points at the pin once there is one. OpenStreetMap's credit shows with the results. Empty Trash of a location clears
  the cached address searches (addresses are private).
- Every search is cached in the project (`lookups`, schema 11, outside the edit log) by its words and language;
  pressed again it reads the cache, saying when it was fetched, with Search again to ask afresh.
- The network (Kevin, Nov 9): one HTTP client for the app, `reqwest` 0.13.5 pinned exactly (MIT or Apache, released
  Sep 8), with rustls and `ring` as Tauri's updater plugin uses them and the OS's own certificate store
  (rustls-platform-verifier), so weather, map tiles, cloud downloads and the updater will share one stack, with no
  OpenSSL. `net.rs` sends only to the hosts on its fixed list (`nominatim.openstreetmap.org` now), only over HTTPS,
  following redirects only to the list, with `Storiiboard/<version> (+https://github.com/mtsm-ph/storiiboard)` as
  the User-Agent. `geocode.rs` keeps one request a second for the whole app (two pressed together go a second
  apart). New crates in the build: rustls, ring, rustls-platform-verifier and their parts, each at least two weeks old
  (openssl-probe, a path finder, not OpenSSL, held one release back for that); licences MIT, Apache, ISC, BSD-3
  (`subtle`) and CDLA-Permissive (`webpki-root-certs`, Mozilla's root list).
- A browser development build has no Rust side: its search answers from a recorded Nominatim answer
  (`src/core/net/recorded/`, fetched once, Nov 9), loaded only in development; a release in a browser has no search.
  No test asks the real service.
- Privacy: the pin says where the address is, so History names it and never shows it, as the address. Nothing about
  the search is logged.
- Tests: Rust (only listed hosts over HTTPS, refused before sending; the User-Agent; a busy service; the recorded
  answer read; entries that aren't places left out; the query as sent; a second between requests); schema 11 (backup,
  the table, a lookup kept, read, replaced, one that can't be read); places read and checked; the pin's edits, map
  link and History; end to end, a search pressed, picked, undone, read from the cache, asked again, cleared, nothing
  found and no connection said in words, axe. Checked once by hand on Windows: a real search through the client
  (rustls, the OS's certificates), names in Spanish when asked.

3.11 as built (Nov 9): assets and attachments (`src/core/model/attachment.ts`, `src/features/assets/`).
- The Assets tile in the Assets workspace (its placeholder until now): the project's PDFs and links, grouped by what
  they're on: the project, a scene, a frame, a location or a person. Attach to picks which; Add PDF… (one or several)
  and Add link (an address, https:// put in front of a bare one, and a title).
- A PDF is kept inside the project (decision 11): checked to be a PDF by its first bytes, at most 50 MB (one that isn't
  is said and skipped), stored by content in `media_files` as a picture is, so Empty Trash and Clean up treat it as
  they treat a picture. Save a copy… writes it where the person chooses: that's how it's opened outside Storiiboard. A
  link is copied with Copy link. Opening either from the app waits for the opener plugin (a dependency Kevin decides
  on).
- Each has its name (a PDF's file name, a link's title) to change in place; Delete sends it to the Trash (an
  Attachments kind there); History names it ("Attached Contract.pdf").
- Format (additive, no schema number, docs/SBD_FORMAT.md "Attachments"): `media` records of kind `pdf` (`file`,
  `source_name`, `byte_size`) or `link` (`url`, `title`) under what they're on; a PDF's bytes in `media_files`.
- Decided by default, review: PDFs share `media_files` with pictures (no new table, no schema bump, Empty Trash and
  Clean up for free) rather than a table of their own; attachments listed in the Assets tile only for now (a section
  in the Inspector, Locations and Cast and crew can follow); Save a copy and Copy link stand in for opening; only
  http and https links; the Storage tab counts PDFs with pictures.
- Tests: an attachment read, listed with what it's on (none under something in the Trash), kept out of a location's
  photos, links kept to the web, sizes; the edits (on what, rename, the Trash, never a picture), a PDF known by its
  bytes and stored by content; end to end, a link on the project, a PDF on a frame (one that isn't refused), saved
  out, renamed, axe, deleted and restored.

3.10 as built (Nov 9): notifications (`src/features/notifications/`, `src/core/storage/notifications.ts`, schema 10).
- The Notifications tile (in no default layout; opened from the Layout menu or the status bar): History's steps,
  newest first, each with what it did, who and when, as History words it. Unread ones lead with an ink dot, in bold,
  and are said as "Unread:" first. Filters All, Unread and This scene (steps that wrote the scene or anything in it);
  Mark all read. Opening a step marks it read and picks what it changed (a frame, else a scene), so the Inspector and
  the board show it.
- The status bar shows the unread count ("3 unread") while there's something unread; it opens Notifications in the
  workspace on screen, focus inside it. The tile shows History's newest 100 steps, and older ones on asking.
- Read state per person (schema 10, docs/SBD_FORMAT.md): the person picked with This is me, else `local`. Not an op,
  never undone, never a step; kept in the file, so it's still read after a reload. Mark all read moves a cursor to a
  place in the log, never a clock time. A step you made counts as read, by the name it's signed with: until sign-in, a
  rename makes your older steps someone else's, and two unnamed people read as one. The log is read once a project,
  then only its new steps.
- Decided by default, review: your own steps count as read (so the count is what others changed in a shared file);
  the reader is This is me, else `local`; opening a step picks its item rather than switching workspace; the status
  bar's count shows only while something is unread; This scene reads where records are now (a frame moved since shows
  under its new scene); a JSON export and import carry the read state.
- Tests: migration 10 (backup, tables, records untouched), read state (one by one, Mark all read moving the cursor and
  clearing reads, per person, one cursor row); end to end, steps by another name unread, the status bar opening the
  tile with focus, a step opened and read, Unread and This scene, axe, Mark all read, your own step never unread, kept
  after a reload.

3.9b as built (Nov 9): gear per day and the first check (`src/core/checks/`, `src/features/gear/GearPicker.tsx`,
`FrameGear.tsx`).
- A shoot day's gear: the Shoot days tile's day has a Gear section, the catalogue as pressed buttons (Gear on this
  day), and what its rentals cost that day (rented items on its list, rate times quantity, in the project's currency).
- A frame's gear: the Inspector has a Gear section after Departments, the same buttons (Gear this frame needs).
- The first consistency check (src/core/checks, shared with the MCP check tool in Phase 7): a frame in a shoot day,
  still to shoot ("Need to shoot", as the day's totals count), needs live gear its day's list doesn't have. The Inspector marks each such item (⚠, and "(not on its day's list)"
  in its name) and says what's missing with Add to Day N; the day's Gear section lists its frames that need gear it
  lacks, each with Add to this day. Gear, frames or days in the Trash are no mistake.
- Every change one edit, so one ⌘Z; History says a list as how many items. Format (additive): `gear_ids` on a shot
  and on a shoot day (item ids in the order picked; what else the list holds is kept).
- Decided by default, review: a frame's gear and a day's list are picked from the catalogue only (nothing typed in
  place); the check finds gear missing from a day, not a day's quantity short of what its frames need together (that
  comes with call sheets); `runChecks` returns findings and changes nothing.
- Tests: the check (frames in a day, gear in the Trash, a day in the Trash, the list read), the list edit (on, off,
  several at once, what else the list holds, gear in the Trash, a list it can't read); end to end, two items, a frame
  in a day needing both, the Inspector's warning and Add to Day, the day's list and rentals, one taken off and the
  day's check offering it back, axe, undo.

3.9a as built (Nov 9): the gear catalogue (`src/core/model/gear.ts`, `src/features/gear/`).
- The Gear tile in Production (its placeholder until now): the project's gear, listed by department in the call
  sheet's order, then by name, each with its quantity (mono), Owned or Rental, and its department. An item has a name,
  a department, a quantity (1 to 999), Owned or Rental and the owner or rental house, a day rate in the project's
  currency (kept to the cent; "$350.00 a day × 2 = $700.00"), and notes. + New item focuses the new one's name.
- The project's currency for every price, at the foot of the list (USD unless set; a short list of currencies, one
  set elsewhere still offered). Prices are written as the app's language writes the currency (in English, as the
  computer's region does, as dates are); a rate is kept to the currency's smallest unit (whole yen, cents of a
  dollar). A field holding what this version can't read is shown read-only, never written over; a field left
  untouched writes nothing.
- Delete item sends it to the Trash (a Gear kind there); History names an item by its name, and its department and
  whose it is in words.
- Format (additive, no schema number, docs/SBD_FORMAT.md "Gear props"): `gear_item` records, `currency` on the project.
- Decided by default, review (docs/PHASE3_DECISIONS.md 7 already was): 3.9 split in two, the catalogue first; an
  item's category is its department; a short list of currencies.
- Tests: an item read safely, the list's order, money in the project's currency; the edits (each field only to a
  valid value, a rate to the cent, the Trash, the currency); end to end, an item made and rented, its rate and total,
  the currency changed and undone, axe, deleted and restored.

3.8 as built (Nov 9): the Calendar (`src/features/schedule/CalendarTile.tsx`, `src/core/model/schedule.ts`).
- The Calendar tile in Production's default layout (its placeholder until now): Month or Week, previous and next,
  Today, and the month or week's name, said when it changes. The grid is one Tab stop; the arrows move a day or a
  week, into the next month too, Home and End to the week's ends, Page Up and Down a month; a date is named by what
  it shows and in full ("16 Monday, November 16, Day 1"), today's underlined and said. A shoot day shows its number on
  its date (and its call time in the week). Weeks start on Sunday in English and Monday in Spanish
  (`calendar.firstDay`).
- Picking a date (the ink fill) narrows the shoot schedule under the grid to that date; Show all days widens it. Each
  day in the schedule: its label, call and wrap, frames to shoot, its scenes, the locations it's at with their status
  (TBD, Confirmed, Cancelled), and its crew confirmed ("1 of 3 confirmed").
- Crew confirmed (docs/PHASE3_DECISIONS.md 10): the Shoot days tile's day lists everyone in Cast and crew (names and
  titles, never contacts) with a Confirmed toggle each (● confirmed, ○ pending, as well as the fill); until call
  sheets say who's called, a day's crew is everyone.
  Stored in the day's `crew` prop, confirmed only (pending is the absence); History says it as a count.
- Decided by default, review: a day's crew is everyone in Cast and crew until Phase 4's call sheets; the first day of
  the week by language; a day's locations are its frames' (a frame's own over its scene's); availability waits for
  Phase 9; the Layout menu's Open tile list in two columns, so it stays short as phases build tiles; a picked date
  stays picked when its shoot day moves (the schedule then says there's no shoot that day).
- Tests: a day's scenes, locations with status, crew counted and confirmed (what else the prop holds kept); dates by
  day and month across years, weeks from either first day, months in whole weeks; end to end (the clock fixed),
  someone confirmed for a day, the day on its date, picked to narrow the schedule with its scenes, crew and frames,
  Show all days, the arrows into December, axe, the week after Today and Next week.

3.7 as built (Nov 9): shoot days (`src/core/model/shootDay.ts`, `src/features/schedule/`).
- The Shoot days tile in the Production workspace (its placeholder until now): the days, numbered by date (Day 1 ·
  Mon, Nov 16; undated last), each with its call time and frame count; + New day dates a new one the day after the
  latest (today for the first). The day picked shows its date, call and wrap (mono), notes, and its totals: frames,
  setups and about how long, at the project's minutes per setup (30 unless changed at the foot of the list).
- Frames this day, in board order, each with Move to (another day, or Not scheduled) and a Move button, so arrowing
  through the choices moves nothing. Need to shoot, not scheduled: the "Need to shoot" frames in no day, by scene,
  each with Add and each scene with Add all. Every move is one edit, so one ⌘Z; focus goes to the row that took a
  moved one's place. The choice starts on the frame's own day, and Move is off until another is picked. The totals
  count what's still to shoot: a frame marked Have since stays listed, uncounted. A half-typed date or time is no
  edit, and a day keeps a date once it has one (a time can be cleared).
- Delete day sends it to the Trash (a new Shoot days kind there); its frames read as unscheduled until it's restored,
  and come back with it. History names a day by its date, a frame's move by the days' dates (in its own history
  too), and frames moved together by the day ("Moved 3 frames to shoot day Mon, Nov 16").
- Format (additive, no schema number, docs/SBD_FORMAT.md "Shoot day props"): `shoot_day` records, `shoot_day_id` on a
  shot, `setup_minutes` on the project.
- Decided by default, review (docs/PHASE3_DECISIONS.md 8 and 9 already were): a day's number is its place by date,
  never stored; until Phase 6 brings setups, a frame without one counts as a setup of its own; a day's frames in board
  order (a stripboard order of its own can come with call sheets); a new day dated the day after the latest; two days
  may share a date (a split day); page eighths aren't in a day's totals yet, since a scene can be split across days
  (they come with the call sheet's scene list, Phase 4).
- Tests: days by date, valid dates and times (February 30 refused), frames in board order, a day in the Trash, only
  "Need to shoot" waiting, totals and durations; the edits (a new day's date, fields, moves in one edit, the Trash,
  minutes per setup); end to end, days made and dated, a scene added at once and undone, a frame added, taken out,
  moved to the other day, the estimate at 45 minutes, axe, a day deleted and restored with its frame.

3.6d as built (Nov 9): your own workspaces (`src/app/shell/ManageWorkspaces.tsx`, `workspaceStore.ts`).
- The Layout menu's Workspace group has Save as new workspace (this layout as it is now, named "<workspace> copy",
  shown at once with its sidebar entry focused) and Manage workspaces… (an in-app window). For a workspace of your
  own, Delete workspace… sits at the bottom with Undo layout change, and asks first.
- Manage workspaces…: Save <workspace on screen> as a new workspace; Your workspaces, each with its name to edit
  (Enter or leaving the field renames it; an empty name is refused), Open, Duplicate and Delete… (asked first); Built
  in, the six sections and the department workspaces in the sidebar, each to Open or Duplicate as a start for one of
  your own, and a department's Remove from sidebar. Focus lands on a duplicate's name, on the sidebar entry of one
  opened, and on what took a deleted row's place.
- The sidebar lists them under Your workspaces, below Departments, in the order made, with the unsaved-layout dot.
  Alt+1 to 6 stay the sections'.
- Yours, kept in this computer's settings (`customWorkspaces`: id, name and the layout it was made from, which Reset
  to default layout brings back), with their layouts beside the others' (`storiiboard.layouts.2`). At most 50. Nothing
  in a project changes, so ⌘Z never touches them. A deleted one's layout and its layout undo steps go with it.
- Decided by default, review: names needn't be unique; a duplicate copies the layout as it is now (not as saved);
  no Delete key on a sidebar entry (deleting asks, in the menu or the window); the cap of 50.
- Tests: made, named, found by id, its own copy of the layout, renamed (never to nothing), deleted with the Storyboard
  taking its place, layouts kept across a restart, undo steps dropped, the cap, names cleaned, a copy's name and tile
  numbering, a corrupt tile left out, the settings read; end to end, saved from the menu, renamed (focus kept, the
  shell renamed) and duplicated in the window, opened, kept after a reload, Alt+2 from one, deleted from the menu and
  from the window (cancelled once), focus after each, axe on the window.

3.6c as built (Nov 9): perspective views (`src/features/department/perspective.ts`, `RestOfCrew.tsx`).
- **A focus view, not security.** Anyone with the .sbd can open everything: the file holds every department's status
  and approvals for whoever opens it, and the app only chooses what comes first. Real access limits come with the web
  companion in Phase 9, where the server sends each person only what they may see.
- Full view, a switch on each person in Cast and crew (the `full_view` prop): on, every department first, as before;
  off, that person's own departments first. Never set, it follows the role: on for the director and the DP, off for
  everyone else. Whose view it is: the person picked with This is me; without one, the role set on this computer (the
  director, the DP, both, or a role standing for no department see everything).
- In the focus view, a frame's department table shows your departments' rows ("Your departments on this frame"), then
  Rest of crew, folded, with how many departments are in it; one click (or Enter) opens it as a grid of its own, and
  focus stays on the button (the next Tab goes into the grid). The scene's approvals fold the same way. Nothing to
  fold (no department of your own, or all of them yours) is the full view. The fold stays open for the session, so the next frame keeps it. The key and
  the note on who approves are said once, under the last part shown.
- Frame cards count your departments alone ("Your departments: 1 seen and 1 done"); the shot list's Departments cell
  names yours, then how many of the rest have anything ("Rest of crew: 1 more").
- Decided by default, review: the focus comes from This is me, else the role on this computer; frame cards and the
  shot list narrow too, not only the Inspector; the fold kept for the session rather than saved.
- Tests: the full view by role and as set, the setting's fallback, the edit, History's words; the focus rule, the
  split, the folded table with its key once, the card's and the shot list's words; end to end, a gaffer picked as themselves seeing Grip & electric first on a frame and the
  scene, the fold opened (its key once) and kept on the next frame, the card and the shot list (ink on the selected
  row), the frame table's fallback for a gaffer, axe on the folded Inspector, Full
  view switched on bringing every department back, a DP's on by default.

3.6b as built (Nov 9): approvals per scene (`src/core/model/sceneApprovals.ts`, schema 9).
- The director or the DP approves each department once per scene, in the Inspector's new Approvals · SC 04 section (a
  row per department in call-sheet order, one Approved box each, who gave it) and in a department's workspace (its
  row alone). Seen, Working on it and Done stay per frame; a frame's table now ends at Done, with a line pointing to
  the scene's approvals.
- Each approval keeps a fingerprint of what that department touches in the scene when it was given: the scene's own
  fields; its frames and note cards in board order, each frame's fields, picture (by content) and sketch; and that
  department's own Working on it and Done on each frame. Priority, Seen, the approvals and other departments' ticks
  are left out. When the scene no longer matches, the row says "Changed since approval" (in the warning colour and in
  words) and who approved "before the change"; the approver's box unticks, and ticking it gives the approval again,
  now. Undoing the change makes it current again, as a fingerprint rather than a time allows.
- Migration 9 (backup first, as every migration; approved by Kevin Nov 9 since it alters data): a scene is approved
  for a department, by an approver, only if every frame in it was, with the latest of those approvals' name and
  time, and starts current. Every frame's approvals then come off (one this version can't read stays). A scene in
  the Trash counts the frames that went with it. The upgrade is one step in History, listing what moved and what
  came off, and the undo stack ends there, as at Empty Trash, so ⌘Z never writes a record back in the older shape.
  Restore to a point before it is a choice undo takes back; that point has no approvals on its scenes.
- History lists a scene's approvals by department ("Camera: — → approved by Sam Reyes (DP)"), never the fingerprint,
  and never offers one to put back. The shot list CSV has a Scene approvals column.
- Decided by default, review: every department counts as touching every frame's fields (as polish 6 has it, every
  department is involved in every frame), so a finer map per department waits for department-specific fields; no
  approvals marker on the board's scene headings yet (the Inspector and the department workspace show them).
- Folded in: `.gitignore` keeps installers out (`*.msi`, `*.exe`, `msi/`, `nsis/`); CLAUDE.md's Navigation names the
  sidebar's Departments list and its Tool rules department status; Phase 7's image-prompt and coverage notes below.
- Tests: the model (sign-offs per approver, given again after a change, taken back, what's written back untouched,
  History's words, a DP's tick taking back the DP's sign-off), the fingerprint (what changes it and what doesn't, a
  picture by its stored file, undo, the Trash), migration 9 (carried only where every frame had it, one person who
  was both, unknown departments, the Trash, approvals off every frame, unreadable ones kept, starting current, one
  logged step that ⌘Z can't pass, Restore to before it undone), History, the CSV; end to end, approving from Director and DP, a change of Camera's own tick and
  of another frame shown and undone, approved again, kept after a reload, taken back, the department workspace's row,
  axe with a changed approval.

3.6a as built (Nov 8): department workspaces (`src/features/department/`, `src/app/shell/workspaceStore.ts`).
- In the Inspector's department table, each department's name opens its workspace: a cell of the table's grid left
  of Priority (the Tab stop still starts on Priority; Left reaches the name, Enter opens). Focus lands on the
  workspace's view, and the frame stays picked.
- A department's workspace is Scenes, the new Department tile and the Inspector, laid out as the Storyboard is; it's
  a workspace like the sections, with a layout of its own (saved, reset, undone per workspace). The Department tile
  shows the frame picked (its picture, number, title, spec and action) with that department's row alone to tick; the
  scene's frames, each with that department's states (the picked one with the accent marker and bold), counted; and
  the department's people from Cast and crew (names, and titles or else roles; never contacts). Picking a frame there picks it on
  the board. Opened into another workspace from the Layout menu, it has a department picker, starting on yours.
- Opened department workspaces are listed under the sections, under Departments, in the call sheet's order, once each.
  The list is the person's, kept in this computer's settings as layouts are (`departmentWorkspaces`), never in the
  file. Delete on an entry, or the Layout menu's Remove from sidebar, takes one off; its layout stays for next time.
  Alt+1 to 6 stay the sections'. Taking off the one on screen brings the Storyboard back, with focus on it.
- Decided by default, review: 3.6 split in two, so Manage workspaces and custom workspaces are 3.6b; the Department
  tile's contents (above); the list in the call sheet's order rather than the order opened.
- Tests: the workspaces (one per department, its layout, ids), their layouts (kept, undone, reset; a store saved
  before them), the sidebar list (once each, in order, taken off), the settings read, the department's view (states
  with Seen, counts, a trashed scene, its people), the table's names; end to end, a department's name opened from the
  keyboard, a tick there seen in the Inspector and undone, a frame picked in the list, its people, axe light and dark,
  kept after a reload, taken off by Delete and by the menu, its layout kept (focus on the workspace when it has no
  Department tile); the tile's picker in another workspace.

3.5c as built (Nov 8): you in Cast and crew (docs/PHASE3_DECISIONS.md 4).
- A person's editor in Cast and crew has This is me: pressed, that person is you on this project, and their row says
  You. Which person is you is kept on this computer (app settings, by project id), never in the file, so it isn't an
  edit and isn't in History; picking another moves it, pressing it again stops it.
- Your approvals follow that person's role and are signed with their name (their initials when your profile asks
  for initials; no name when they're unnamed); opening a frame marks it Seen by the departments their role stands for
  together with the ones ticked, so a DP on Grip & electric still marks Camera (both approved by Kevin, Nov 8). A Director in Camera, or a DP in Direction,
  approves as the Director and DP and marks both, as the local setting's "Director and DP" does (approved by Kevin,
  Nov 8). A person picked with no role approves nothing, and Settings → Project says so.
- "Your role on this project" (Settings → Project) stays the fallback: until you've picked yourself, and while the
  person you picked is in the Trash (a restore brings your pick back). Once you have, it says who you are there.
- Tests: what a person stands for (roles, departments, Director and DP), the fallback (none picked, in the Trash, gone,
  another project's, not a person), the picks kept on this computer and capped; end to end, yourself picked as a DP in
  Direction approving as Director and DP and marking Seen by Camera and Direction, kept after a reload, and the
  setting back once that person is in the Trash.

3.5b as built (Nov 8): characters cast, and the Team section.
- A person's editor in Cast and crew has Plays: the project's characters (from the script import), each cast by one
  person (`character.cast_id`); picking one another plays moves it, picking it again uncasts it; one edit each. A
  character played by someone else says who. A cast member in the Trash reads as none, and a restore gives them their
  characters back.
- The Team section is built: the project's people by department in the call sheet's order (someone in two is in
  both; those in none last), each with their title or role, and the characters a cast member plays. Read only; no
  contacts. Edited in Cast and crew.
- History names the person cast, as the step left them, never their id.
- Tests: who plays what (a trashed cast member as none), casting (one edit, moving, nothing when nothing changes), the
  team's groups, History's wording; end to end, a script's characters cast, the Team section's groups.

3.5a as built (Nov 7): the Cast and crew tile (`src/features/people/`, `src/core/model/person.ts`).
- Production's Cast and crew tile lists the project's people by name, each with their role and departments, with
  + New person; the one picked opens in an editor: name, role (the app's 14), departments (several, in the call
  sheet's order), a title for the call sheet, phone, email and notes, each one edit when it's left, and their own
  fields as frames and locations have them.
- Phone and email are private: History names the field and says it was set, changed or removed, never the value.
- Delete person sends them to the Trash (a new kind there: listed, filtered, restored, cleared by Empty Trash).
- Tests: fields read, the list, each edit (one each, none when nothing changes), the Trash, History's words and its
  hidden contacts, the reserved field names; end to end, a person added, named, given a role, departments and a
  phone, one undo, axe light and dark, Delete and Restore.

3.3b as built (Nov 7): photos, own fields, and a frame shot elsewhere.
- A location's editor has Photos: Add photos… stores recce pictures in the project as frames' pictures are (`media`
  records under the location), all of one pick in one edit; each has Remove, to the Trash on its own, labelled there
  "(photo of Diner)", and restoring one whose location is in the Trash brings the location back with it.
- "Your fields" on a location: custom fields as frames have them (the `custom` prop), names suggested from the
  project's other locations.
- The Inspector's Links has "This frame shot at": the scene's location by default, or another live location for an
  insert or a pickup shot elsewhere (`shot.location_id`). The shot list's location column reads the frame's own one
  first; a trashed location reads as none.
- Tests: frame location (own, scene's, trashed), the edits (none when nothing changes), photos added and trashed, the
  Trash label and restore; end to end, a photo added, a field of its own, a frame set to another location and the
  shot list CSV saying so.

3.3a as built (Nov 7): the Locations tile (`src/features/locations/`, `src/core/model/location.ts`).
- The Production workspace's Locations tile lists the project's locations (status, how many scenes are set there),
  with + New location; the one picked opens in an editor: name, status (TBD, Confirmed, Cancelled), address, contact
  (name, phone, email), parking, power and notes, each one edit when it's left, and the scenes set there. A location
  typed on a scene from the "/" menu is the same record, so a change here is a change for every scene there.
- Copy map link puts an OpenStreetMap search for its address on the clipboard: nothing is looked up from the app (the
  Nominatim search is 3.4). Opening the link in the browser needs Tauri's opener plugin, a new dependency, so it
  waits for Kevin (docs/PHASE3_DECISIONS.md 1).
- Delete location sends it to the Trash (a new kind there: listed, filtered, restored, and cleared by Empty Trash); its
  scenes keep their link, so Restore brings them back with it, and views read them as having no location meanwhile.
- Tests: fields read, the list with its live scenes, the map link, the edits (one each, none when nothing changes);
  end to end, a location set from the "/" menu edited, undone, a new one named, Delete and Restore, axe light and dark.

3.2 as built (Nov 7): company profiles (`src/core/model/company.ts`, `src/app/company/`).
- Settings → App gains Company profiles: production companies (name, address, phone, email, website, logo) saved on
  this computer, in the app's settings, not in any project. A logo is made small (512 px, PNG); a full settings store
  says so and changes nothing.
- Settings → Project gains Production company: attaching a profile copies its details and logo into the project (the
  `company` prop and a picture under the project) in one edit, so the file carries them to a computer without the
  profile. The copy stays as copied; Update from profile shows when the profile has changed and copies it again;
  Detach takes it off. Each is one ⌘Z; a replaced logo goes to the Trash. History names the company, never its ids or
  contacts. A file's copy from someone else's profile still shows by name.
- Tests: profiles read and capped, a copy kept with a later version's fields, a changed profile told apart (its logo
  too); the store saving, refusing when full and removing; the attach, re-attach and detach edits; end to end, a
  profile with a logo attached, the profile changed, Update from profile, and each undone.

3.1 as built (Nov 7): production details (`src/core/model/projectDetails.ts`, Settings → Project).
- Settings → Project gains Production details: the stage (Discovery, Contract, Pre-production, Production, Editing,
  Revising, Pending invoice, Complete, or none), logline, format and runtime as free text, the client contact (name,
  company, email, phone) and the deliverables checklist (add, tick, rename, remove). Props on the project record, so
  each change is an op: ⌘Z takes it back, and History names the field. No format change (docs/SBD_FORMAT.md).
- The stage is never the project's state (draft, active, archived). Client and deliverable fields this version doesn't
  know are kept when one is changed. The client's email and phone are private: shown here, never logged.
- Tests: the details read (an odd or unknown value as empty), every stage named, a change keeping unknown fields; the
  tile's fields and checklist boxes; end to end, the stage, client and deliverables set, a tick undone, all there
  after a reload.

### Phase 2 milestones

Plan approved Nov 5, 2026: ffmpeg as LGPL sidecars (the one new dependency), schema 8 for video, a playback-copy
cache (about 50 GB, oldest out first, movable in Settings → Storage), LUTs as `.cube` files applied to the playback
copy and stills, never the original. One PR per milestone, each into `v2`. Two review stops: after 2.4 (the Player
plays real footage) and at the gate; at each, a checkpoint and a checklist, and the work goes on.

| Milestone | PR | State |
|---|---|---|
| 2.1 ffmpeg and ffprobe sidecars, LGPL, built in CI from one pinned release; Rust reads a video's facts | #71 | Done |
| 2.2a Schema 8 (video records, `clip`, `from_video`, `luts`); timecode maths; Rust stills and file status; the browser build's stand-in | #72 | Done |
| 2.2b Link a video to a frame by drop or browse, its first frame as the picture; video details in the inspector; missing flag and Relink; the sidebar's phase labels (from 2.4) | #73 | Done |
| 2.3a Playback copies, the engine: made one at a time with the computer's H.264 encoder, progress, Cancel, `.partial` until done; cache folder, 50 GB cap, Clear, Move to another drive | #74 | Done |
| D1 zimg and dav1d built into ffmpeg: HDR stills and copies tone-mapped to BT.709; AV1 | #76 | Done |
| D2 windows-sys: the free-space floor (10 GB) for copies; ffmpeg stops with the app on Windows, crash or not | #77 | Done |
| 2.3b Playback copies, what you see: the queue, the copy's state in the inspector, Settings → Storage (copies, remembered videos), ffmpeg's licence; several mono tracks mixed into the copy's sound | #78 | Done |
| 2.3c Silent tracks left out of the mix; a relink's undo never leaves the other file's copy on the video | #79 | Done |
| 2.4 The Player plays real footage (Stop A) | #80 | Done |
| 2.5 LUTs per video | #81 | Done |
| 2.6 Crop | #82 | Done |
| 2.7 Still capture into a frame | #83 | Done |
| 2.8a The frame's clip plays in the inspector | #84 | Done |
| 2.8b Save clip as file | #85 | Done |
| 2.9 JSON export and import carry all of it | #86 | Done |

HDR tone-mapping (decided Nov 5, Kevin): FFmpeg's own scaler doesn't map PQ or HLG to SDR, and its `tonemap` filter
needs linear light, which means zimg (`zscale`). zimg (WTFPL, approved as an exception to the licence list) and dav1d
(BSD-2-Clause, for AV1) come in D1; windows-sys (MIT or Apache 2.0) in D2. See "Dependencies and licences".

2.9 as built (Nov 7): project data as JSON, out and back (`src/core/storage/projectJson.ts`, docs/SBD_FORMAT.md
"Project data as JSON").
- Export → Project data (JSON) writes the whole project as one JSON file, `Bey County project data.json`: every table
  of the .sbd, row by row, pictures as base64, a row to a line. It's the project, not a view: the Trash, the History,
  named versions, LUTs, slate numbers and Seen go too, whatever scene is picked, and no watermark.
- Import project data… on the Projects screen reads one, checks it (format, versions, every table and column against
  the schema it names), asks where the new project goes (named after its title), builds it at the JSON's schema, puts
  every row in in one transaction and opens it, upgraded as any older file. It never writes over a file.
- Tests: a project with one of everything (pictures with every byte value, a LUT, frames, one in the Trash, an undone
  edit, a named version, Seen, a slate number) out and back, every table equal row for row, and out again to the same
  JSON; an import from an older schema, upgraded on open; refusals named; an injected column name refused; end to end
  in the memory build: export, import, the frame in the Trash restored in the new project.

2.8b as built (Nov 7): Save clip as file (`src/features/video/saveClip.ts`, video.rs `save_clip`, `clip_save`).
- Save clip as file… in the inspector's Video section renders the frame's clip, in to out, from the original (never
  the playback copy) as an H.264 MP4 with the computer's own encoder: frame-exact (two seeks, then the frames by their
  own timestamps, as a still is grabbed), its pixels made square at full size, cut to the frame's window (the clip's
  crop), fitted to 1920 px on its long edge, graded with the video's LUT (or, for HDR without one, tone-mapped), with
  its first sound track from the same moment, as AAC stereo.
- It's named as the frame's picture exports, `SC004_4A.mp4`, so an editor matches it to the slate, and goes only where
  the person chooses, through the export Save dialog (MP4 joins the export file types). It's written beside the file
  first and put in place only once whole. The notice line says when it's saving and when it's saved.
- The browser build has no ffmpeg: there it says the desktop app is needed.

2.8a as built (Nov 7): the frame's clip plays in the inspector (`src/features/video/ClipPreview.tsx`).
- The Video section shows the frame's clip, in to out, framed as the frame is (the clip's crop, 2.6), from the
  playback copy, never the original, in a box of the frame's shape. It stays on its in point until Play clip, then
  goes round and round, muted, until Pause clip: a reference to watch while the rest of the inspector is in use (the
  Player tile is the player). It never plays by itself.
- The loop turns on each frame the webview presents (requestVideoFrameCallback), so it turns at the out point, not a
  quarter second past it as the time updates would; an older webview falls back on those.
- Split from Save clip as file (2.8b) to keep each PR small.

2.7 as built (Nov 7): still capture into a frame (`src/features/video/grabStill.ts`, video.rs `still_graded`).
- Grab still in the Player (or G, from anywhere in it) takes the frame showing from the original, never the playback
  copy, at up to 2560 px on its long edge, upright with square pixels, graded with the video's LUT as its copy is (the
  LUT after the scale, in place of the tone-mapping for HDR footage). It becomes the frame's picture in one edit: the
  old picture goes to the Trash, the frame keeps its clip, and the picture is framed by the clip's crop, so it shows
  what the frame's window showed (2.6). The whole frame is kept, so it can be framed again with nothing lost.
- The picture's `from_video` records the video, the frame, its rate, its timecode as on the slate, the take's name and
  the LUT's id and name, enough to grab the same frame again after a relink or a LUT change (schema 8; no format
  change). The inspector says it: "Still at 01:00:02:00 · SLog3 to 709".
- The browser build's stand-in grabs from the file handed over, ungraded (it has no ffmpeg).

2.6 as built (Nov 7): framing a frame's clip over the Player (`src/features/video/FrameWindow.tsx`, `crop.ts`
`cropWindow` and `moveWindow`).
- The Player draws the frame's window over the whole take: the part the frame shows, in the project's aspect ratio,
  with the rest dimmed and the window's edge in paper on ink, so it shows on any footage. It's the clip's `crop`
  (schema 8, no format change), the same model as a frame picture's crop (1.11) seen the other way round: the window
  moves over the picture, rather than the picture under the frame.
- Drag the window, or with it focused use the arrow keys (Shift for bigger steps), + and − to zoom and 0 to centre;
  or the Framing slider and Centre under the Player. A change saves once, when it's let go, so each move is one undo
  step; one where it is already makes no edit. The Player's own keys (comma, period, I, O, Space) still work while
  the window has focus. A screen reader hears the framing once it's saved.
- The picture sits in a box of its own shape, fitted to the tile as it's resized, so the window lies on the picture
  and not on the bars around it. The picture never shrinks below 120 px for the controls; a short tile scrolls.
- The frame's picture keeps its own crop. Still capture (2.7) and clip capture (2.8) take the clip's.

2.5 as built (Nov 7): LUTs per video (`src/core/media/lut.ts`, `src/features/video/lutEdits.ts`, playback.rs).
- A LUT belongs to the video, not the frame: every frame of a take shows it. The inspector's Video section lists the
  project's LUTs with None (as shot), and Load LUT… opens a `.cube`. Loading, picking and taking one off are each one
  edit of the video's record, so each undoes. The `.cube` text is stored once per project by its SHA-256 (schema 8's
  `luts` table, no format change), in the same transaction as the edit that first uses it; loading the same text
  again, under any name, uses the row stored.
- A `.cube` is read by its rules before it's stored: a 3D LUT of 2 to 256 points (FFmpeg's limit), an optional
  domain, and exactly size³ rows of three numbers, comments allowed anywhere. A 1D LUT, or a 1D shaper before the 3D
  one, is refused with words that say so; so is a short or garbled file, and a domain FFmpeg's lut3d can't apply as
  the file means it: measured with the sidecar, lut3d scales by the domain's width but never shifts by its start and
  never scales up, so only DOMAIN_MIN 0 with DOMAIN_MAX 1 or more is kept (Resolve's LUT_3D_INPUT_RANGE the same).
  FFmpeg is handed the size, the domain and the rows alone, so a keyword it doesn't know never trips it.
- The LUT grades the playback copy, never the original. The SHA-256 of the text ffmpeg reads joins the copy's key, so
  the same take under another LUT, or none, is another copy; two files that differ only in a title share one; a change
  to how files are read makes new copies; a copy made before 2.5 keeps its key. ffmpeg runs in a folder of the LUT's
  own, a random name made new for the one encode (never one already there) and gone after, and names the file alone
  (no path to escape on Windows). The LUT
  goes after the scale, with tetrahedral interpolation as grading tools use, and the copy is tagged BT.709. For HDR
  footage the LUT takes the place of the tone-mapping: a LUT is made for the signal the camera recorded. Colours keep
  their matrix through it (an identity LUT leaves a saturated BT.709 patch, tagged or not, within 3 of the copy
  without one).
- Loads of a LUT take turns, so two loads of the same file at once store it once and both videos name it.
- A LUT change asks for the graded copy at once, as a relink does; a copy being made under the old LUT is stopped,
  and its result is never kept. The same file under two LUTs (two videos of one take, graded apart) is two requests.
- Stills grade with the LUT in 2.7 (still capture), which reads from the original; the frame's picture isn't touched
  by a LUT change.

2.4 as built (Nov 7): the Player tile (`src/features/video/PlayerTile.tsx`, `PlayerView.tsx`, `player.ts`).
- It plays the selected frame's video from its playback copy, never the original. Copies are served to the page by a
  URL scheme of the app's own, `sbdcopy` (playback.rs `serve_copy`): a request names one finished copy by its file name,
  found only in the copies' folders, so nothing else on the computer is reached; answers come in slices of at most
  2 MB, as range requests ask, so a copy is never read into memory whole. The first request marks the copy used, for
  the cap. No new dependency: Tauri's asset protocol would have needed its `protocol-asset` feature (and a crate with
  it) and a scope that can't name a drive picked at run time. The page's content policy allows media from it.
- Comma and period step a frame (with Shift, ten), I and O set the frame's in and out (one undo step each, never a
  backwards clip), Space plays and pauses; the keys work wherever focus is in the Player. The scrubber is a native
  range input (arrow keys step a frame) over a drawn rule, the clip's in to out as an ink band and the playhead in the
  accent, outlined in ink. The frame showing is read from each frame the `<video>` presents where the webview says
  (`requestVideoFrameCallback`), else from its time updates; a seek goes to the middle of a frame. Timecode in mono.
- The Player asks for a copy of a video shown without one, once; a copy cancelled or cleared while shown is left to
  the person (Make playback copy), and one that vanishes while it plays (the cap, a Move) is made again.
- The browser build keeps each video handed over for the page (`src/app/videoFiles.ts`), which its stand-in copies
  point at, so the end-to-end tests play real footage.

2.3c as built (Nov 7), Kevin's answers of Nov 7:
- Silent tracks are left out of the mix. Each separate mono track is listened to first (`video::track_peaks`): one run
  of ffmpeg reads forty 1-second windows spread evenly through the take (the first 40 s of a shorter one, or of one
  whose length isn't known), so a mic live for any stretch longer than a fortieth of the take is heard, while only
  40 s of a 100 GB MXF are read. A track whose loudest moment there stays at or below -70 dB (an input with nothing
  plugged in; a live mic's room tone alone comes above it) is left out; one ffmpeg says nothing of is kept; the others are mixed, each at 1/N
  of them, so an FX6 with two empty tracks plays at its live pair's level. One live track plays as it is. Every track
  silent: a copy without sound, named `<key>-quiet.mp4`, whole as it is (never made again), and the inspector says
  every sound track is silent. If the tracks can't be listened to now, all are mixed as before. Recipe `2.3-4`.
- A video whose file changes (a relink, or its undo or redo) while its copy is made: that copy is stopped and one of
  the new file made; anything else known about the old file (made, failed) is dropped and looked for again; and a
  result about a file the video no longer points at is never kept as its own (`playbackCopies.ts`, `fileOf`). A video
  put in the Trash isn't another file: its copy carries on, and is looked for again once it's restored.

2.3b as built (Nov 6): what the person sees of the copies, and the sound of files that keep each channel apart.
- The queue lives on the page (`src/features/video/playbackCopies.ts`): one `playback_make` at a time, the rest waiting
  there in the order asked, so a waiting copy holds no thread in Rust and comes off the queue at once when cancelled. A
  project switch stops the copy being made and forgets the rest. A copy is asked for when a video is linked or relinked
  (a relinked video's copy is made again), from the inspector, and (2.4) by the Player; opening a project asks for none,
  so a big project never fills the cache unasked.
- The inspector's Video section says where the video's copy stands: none yet, waiting its turn, being made (with a
  progress bar), ready, ready without sound, or failed in Rust's words. One button goes with it, Make playback copy
  (Try again after a failure) or Cancel copy, one element whatever its job, so focus stays on it; when it goes (the copy
  made), focus moves to the copy's line (to Relink if the video went missing). A double click or a held key doesn't
  make and cancel by turns. A live region reads each change. A copy known as made is looked for again when asked for
  (the cap or a Clear may have removed it), and a shown one when another copy is made (its room may have come from
  it); the inspector looks again when the video's file changes (an undo of a relink). A failure keeps its words
  through a Clear, a Move or a cap change.
- Settings → Storage, for this computer, below the project's sections (and on its own with no project open):
  - the copies: how many, their size against the cap (decimal GB, with a gauge), the copy being made and how many wait,
    the folder, the drive's free space against the floor, the cap and floor fields (whole GB, thousands grouped only as
    the app's language writes them; saved with Enter where they are, or as the person moves on, and said; an entry
    out of range says so and goes back), Move to another drive… (says a copy is being made before asking for a folder), Move back, and
    Clear… (asks first; cancelled, focus stays on the button). A lower cap tells the inspector to look again. If the
    copies can't be read, the section says why and still offers Move back;
  - remembered videos, with Forget… (asks first, then checks the open project's videos again; a list that can't be
    saved, or couldn't be read at start, forgets nothing and says so);
  - FFmpeg, with its licences in a window of their own (FFmpeg's LGPL and notes, zimg's, dav1d's, where the exact
    sources are), read from the installed files by `licence_text`, which takes only the five names the app ships.
- Sound kept as several mono tracks (Sony and Canon MXF, a recorder's MOV) is mixed into one: each track at 1/N, then
  1 dB under, the same on both channels, so the mix never clips (Kevin, Nov 6). A file with one track, or tracks of two
  channels or more, keeps its first track as before. Like the sound itself, the mix is given up only when it's the
  cause: an attempt failed and the mix alone (its first second) can't be made. Then each track is tried alone and the
  ones that decode are mixed (or the one that does, as it is; if each decodes alone, the first, as before the mix);
  with none, the copy has no sound. Any other failure (a hardware encoder, then Windows' software one) keeps the mix.
  Tracks that can't be counted (a share slow to answer) give no copy yet, never one with the first track alone. The copies' recipe moved on (`2.3-3`), so copies made
  before are made again.
- `playback_info` says whether the copies were moved (`moved`), for Move back.
- The browser build pretends: each copy takes 2.5 s and 2.4 MB, kept for the page; the licences say they ship with the
  desktop app.
- A window opened from inside another (Licences, from Settings) closes alone on Escape (`src/ui/InAppWindow.tsx`).

D2 as built (Nov 6): windows-sys 0.61.2 (Windows only; the version already in Tauri's tree) and `src-tauri/src/os.rs`.
- A free-space floor, 10 GB by default (1 to 1,000 GB, `playback_set_floor`; 2.3b shows it in Settings → Storage).
  Before a copy starts its drive must keep the floor free after the copy (about 1.6 MB a second of video): the copies
  used longest ago in the folder copies go to make the room, never the video's own, and only if together they can;
  otherwise the copy is refused and nothing is removed. They go one at a time, the drive read just before and after
  each (for up to a second, as a NAS reports freed space late); one whose space doesn't come back (a Time Machine
  snapshot, a share's recycle bin) stops the rest going, and that drive is remembered: nothing more goes there for
  room until its reading shows the space came back (or half an hour passes, or the copies move). While the copy is
  made a thread of its own only reads the free space, every 2 s (a share that stopped answering never holds up the
  encode's watch): down to the floor, the copy stops and leaves nothing; it's then measured by what it wrote (or taken
  as twice that when its length isn't known) and made once more if older copies can make that room. Once the copy is
  whole it's held to the floor once more (older copies make room, or it isn't kept). Room is made only on the make's own thread, in its turn,
  so two never make room at once. A Move where not one copy can cross above the floor is refused with nothing changed;
  otherwise it copies across drives only what fits, and the rest stay where they were, still played, and the Move says
  so. `playback_info` adds the floor and the drive's free
  space.
  Windows reads it with `GetDiskFreeSpaceExW` (after any quota), a Mac with `statvfs` (without the space macOS can
  purge, so a little under Finder's figure); a drive that can't tell is taken as having room. Linux (the tests) stands
  in with a pretend drive.
- ffmpeg ends with the app, crash or not. Windows: every sidecar joins one Job Object with kill-on-close, so the system
  ends them when the app ends however it ends. A Mac: each encode's process id and start time are kept in
  `playback-running.txt` (the app's data folder) while it runs, and the next start stops any that is still that same
  process running ffmpeg (so an id another program has taken since is left alone, and an app moved or run from
  elsewhere still finds its own). Tested by killing a real app process on each platform.

D1 as built (Nov 6): `scripts/ffmpeg/build.sh` builds zimg 3.0.6 (autotools) and dav1d 1.5.4 (meson), each pinned with
its checksum, statically, and configures ffmpeg with `--enable-libzimg --enable-libdav1d`; the self-checks add
`zscale` and the `libdav1d` decoder (listed before FFmpeg's own AV1 decoder, which needs a GPU, so it's used). The
installers ship `zimg-LICENSE.txt` and `dav1d-LICENSE.txt`; `ffmpeg-SOURCE.txt` records both sources; their tarballs ride
in the CI artifact. A folder of pre-downloaded sources (`SBD_FFMPEG_SOURCES`, still checksummed) lets the build run
without the download sites. A PQ or HLG video's stills and playback copies go through zscale to linear light, Mobius
tone-mapping and back to BT.709 (`video::tone_map`; tags a file leaves out are taken as BT.2020; a matrix FFmpeg's own
filters refuse, such as ICtCp, is re-tagged for them and read as itself by zscale), with the file's own peak for PQ, so
203-nit reference white lands near SDR white (236 of 255 in a still) where it used to show mid-grey (146); a still
tone-maps only its own frame; copies are tagged BT.709 and the copies' recipe moved on, so any made before are made
again. AV1 decodes exactly (AOMedia's conformance vector, checked
by its frame checksums, `src-tauri/testdata/`).

2.3a as built (Nov 6), `src-tauri/src/playback.rs`. Five review rounds; each checkpoint ran the copies on the Mac's
VideoToolbox and Windows' Media Foundation (software, as CI has no GPU).
- A copy: H.264 (VideoToolbox; Media Foundation hardware then Microsoft's software encoder, NV12, High profile), at
  most 1920 px on the long edge, square pixels, deinterlaced, the original's exact rate, a keyframe every 12 frames,
  AAC stereo 160 kb/s; frame 0 is the video's first frame. No index pass (`+faststart`): a local file plays as well
  with its index last. Linux makes MPEG-4, for the tests only.
- One copy at a time. Each request is on the list from the moment the page asks, before the file is checked, so a
  Cancel reaches it anywhere; several requests for one video share the work.
- Whole or nothing: written as a partial (one per attempt) and renamed only when the original is unchanged (path, size,
  time in two-second steps), ffmpeg's own words say no read failed ("Error during demuxing", or MOV's "partial file"
  inside the file), the copy is no shorter than a second or one frame in a hundred, and its sound is there. A file
  that was only cut short still gets its copy; a MOV trimmed by an edit list counts as long as it plays (video.rs).
- Sound that can't be read (its first second tried alone) gives a copy without it, named `-silent`, which the app can
  point out; a later run tries the sound again. Any other failure never drops the sound.
- A stall is ffmpeg's counts standing still for 90 s (it reports twice a second even when stuck); a kill that doesn't
  take is given up on after 10 s; a computer that slept isn't taken for stalled.
- The cache: `Storiiboard Playback Copies` in the app's cache folder or on a picked drive, the cache folder standing in
  while that drive is away; a 50 GB cap (copies used longest ago go first); Clear; Move, which keeps any folder it
  couldn't empty (or reach) on a list the app still looks in, and refuses when the settings file can't be saved. One
  of our own copies is refused as an original.

2.1 as built: `scripts/ffmpeg/build.sh` builds FFmpeg 8.1.3 (checksum pinned) with `--disable-autodetect`, static,
and checks itself: the LGPL 2.1, no GPL, nonfree or version3 flag, the `lut3d` filter. VideoToolbox on a Mac, Media
Foundation on Windows (built in MSYS2's MINGW64, linked statically). CI builds once per change of the script or its
action and saves the cache as soon as a build succeeds; each new checkpoint branch builds the Mac and Windows sidecars
once. The installers ship the binaries as Tauri sidecars with the LGPL, FFmpeg's licence notes, and the exact source,
commit, compiler and configure line; the source tarball rides in every CI artifact. `src-tauri/src/video.rs` starts
the tools with no console window on Windows (a release build looks only beside its executable), lets ffprobe open
local files only, gives up after 30 seconds, and returns the codec, size, pixel shape, exact rational frame rate,
length in frames, source timecode, rotation (clockwise, 0/90/180/270), audio, HDR and bit depth. Interlaced footage
reads at its frame rate, not its field rate; a variable-rate phone clip at the nearest standard rate, counted by its
length. Its tests make their own clips with the sidecar: 23.976 with timecode, 29.97 drop-frame with audio in a file
named in Spanish and Japanese, a phone's three rotations, 10-bit HLG, 25i HDV (its pixel shape; field rates are unit-tested from ffprobe's JSON), a clip with dropped frames, and an
inverting LUT that turns black white.

### Phase 1 milestones

Plan approved Nov 2, 2026 (one panel per shot; numbers follow board order until Lock numbers; storyboard before
themes). One PR per milestone, each into `v2`.

| Milestone | PR | State |
|---|---|---|
| 1.1 Theme tokens: semantic names, default accent #DF5E27, logo on a fixed brand token #E0612B | #16 | Done |
| 1.2 Write check and hidden lock file; second-computer warning | #17 | Done |
| 1.3 Synced-folder detection, one-time note, New starts locally when Documents is synced | #18 | Done |
| 1.4 Local backups for synced projects (by file id), Show backups, setting | #19 | Done |
| 1.5 Browser test driver (sql.js, dev and e2e only) | #20 | Done |
| 1.6 Storyboard model, shot numbering and Lock numbers, aspect ratio, Scenes tile | #21 | Done |
| 1.7 Storyboard grid: frame cards, keyboard, Delete to the Trash | #22 | Done |
| 1.8 Frame inspector | #23 | Done |
| 1.9 Shot list and Strip views | #24 | Done |
| 1.10 Image storage (schema 3: media, thumbnails, note, character, stroke); 2560px cap, colour kept; backup sizes measured | #25 | Done |
| 1.10b Backups as APFS clones, step-by-step full copies elsewhere, 5 GB cap; Linux checks on every PR | #26 | Done |
| 1.11 Frame images: drop, paste, browse, crop; original's path kept as a pointer | #27 | Done |
| 1.12 Drag to reorder; "/" menu; notes; scene locations by name | #29 | Done |
| 1.13 Sketching: stroke records, Konva editor, SVG on cards | #30 | Done |
| 1.14 Theme generator: 12 families, OKLab accents, AA fit, in a Web Worker | #31 | Done |
| 1.15 Theme switching (200ms ease), Follow project, window background | #32 | Done |
| 1.16 Onboarding and Settings → Theme | #33 | Done |
| 1.17 Script import: Fountain and FDX, with a preview | #34 | Done |
| 1.18 Script import: PDF, read by its layout | #35 | Done |
| 1.19 Custom fields on shots: inspector and shot list | #36 | Done |
| 1.20 Trash tile: filters, Restore (erased sketch strokes left out) | #37 | Done |
| 1.21 Empty Trash; Settings → Storage, Clean up old pictures | #40 | Done |
| 1.22 History tile: every step in words, restore a point, an item's old values | #41 | Done |
| 1.23 Named versions (schema 4): name a point, Open version as a copy | #42 | Done |
| 1.24 Export registry, shot list CSV, PNG frames, Watermark Settings | #43 | Done |
| 1.25 PDF storyboard | #44 | Done |
| 1.26 Locked scenes keep every letter they've used, after Empty Trash too (schema 5) | #46 | Done |
| 1.27 Compact project in Settings → Storage: a backup, then VACUUM | #47 | Done |
| 1.28 A notice for frames a lock re-letters; a minute's second backup is "(2)", never a later time | #48 | Done |

Gate: Kevin boards a real Bey County scene in one sitting, from script import to finished frames, and exports it as
a PDF.

Before the gate (Kevin, Nov 4): a checkpoint for all of Phase 1 (the smoke set on Linux and in WebKit on the CI Mac,
both installers), Kevin tests 1.11 to 1.25 as one batch, then a polish step, which turns the screenshot tests back on
with fresh baselines. Phase 2 waits for the gate.

Decided Nov 4 (Kevin):
- 1.26: a locked scene remembers every letter it has used, in a table that Empty Trash, undo and History restores
  leave alone, so a letter that has been on a slate is never given out again. Schema 5, with a migration (backup
  first) that fills the table from what the file still holds. The Empty Trash warning stays only where the migration
  can't recover numbers (a project that ran Empty Trash before schema 5), while a scene is locked.
- No automatic compaction: only Kevin's test projects predate 1.21. Compact project (built early, as 1.27) is in
  Settings → Storage: it makes a backup, then compacts the file (SQLite's VACUUM), which clears free space older
  builds left and shrinks the file after big deletions.
- 9:16 PDF frames: Kevin prints a page and reports back.
- pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1 (MIT): confirmed.

### Phase 1 polish (Kevin, Nov 4)

Kevin tested 1.11 to 1.28 on Windows: all passed. The polish step comes before the gate, one PR per milestone into
`v2`, each reviewed until no high or medium finding is left, then merged with a merge commit once the quick checks
pass. Kevin reviews at three stops, each with a checkpoint for fresh installers and a short checklist: after the
first group (2, 3, 4, B, C, A), after 6 and the palettes, and after 7 with its glossary.

| Milestone | PR | State |
|---|---|---|
| P1 Language layer: every word through translation files (src/core/i18n), English only; Settings → App language | #49 | Done |
| P2 Hide and show the sidebar: a button and a shortcut, the layout reflows, the choice remembered | #50 | Done |
| P3 History button in the top bar, beside the project name | #51 | Done |
| P4 Docking along the full top, right and bottom edges of the window (never the left, the sidebar's) | #52 | Done |
| PB In-app windows for deeper options (Settings, Watermark Settings…): move with the app, Escape closes, focus stays inside | #53 | Done |
| PC Sidebar foot: Settings gear (Settings leaves the sections), a local profile, the web version (Phase 9, disabled); a thin strip keeps them when the sidebar is hidden | #54 | Done |
| PA Menus in labelled groups with separators, shortcuts at the right, "…" on what opens more options (grouping shown to Kevin first) | #55 | Done |
| P5 Delete a whole scene to the Trash from the Scenes tile and the sidebar, with undo and Restore; a locked scene's letters stay used | #56 | Done |
| P6a Department status per shot (Priority, Working on it, Done, Approved) in place of on/off tags; schema 6 with migration; "Your role on this project" | #57 | Done |
| P6b Seen (automatic, by your department) and a compact status summary on frame cards, the shot list and the CSV | #58 | Done |
| PPa Scene colour palettes from the frames' pictures: generate, lock and regenerate, reorder, delete, copy the hex, all undoable; in the inspector and the Scenes tile | #59 | Done |
| PPb Color script tile, eyedropper on any frame, palettes printed in the PDF storyboard | #60 | Done |
| P7 Latin American Spanish, with a glossary of film terms for Kevin; Spanish scene headings in script import | #61 | Done |
| P8 Screenshot tests back on with fresh baselines, both languages, both themes | #62 | Done |
| PD The open decisions from the review stops: the easy-to-undo ones taken by default, for Kevin to review | #63 | Done (decisions marked for review) |
| Q1 Quality pass: the low-severity review findings still open from Phase 1 | #64 | Done |
| Q2 Quality pass: a 300-frame project with pictures stays fast (scrolling, views, undo, saving) | #65 | Done |
| Q3 Quality pass: accessibility on every screen (keyboard only, focus, contrast in both themes and languages) | #66 | Done |
| PE Who made each edit: the profile's name (or initials) on every edit, shown in History | #67 | Done |
| PT Titles edited in place: a pencil beside every scene name and frame title; frames get an optional title | #69 | Done |

Decided Nov 5 (Kevin):
- PA's menu grouping is approved, with these rules: no Manage workspaces until Phase 3 brings department and custom
  workspaces; each menu short, most-used first, at most four groups, and anything that undoes or deletes in its own
  group at the bottom; items not built yet are hidden, not greyed out (phase placeholders stay in tiles and the
  sidebar only); shortcuts at the right, and "…" on items that open an in-app window.
- P7's glossary offers Kevin one choice: shot size abbreviations in Spanish (PG, PM, PP…) or kept in English (WS, MS,
  CU…), as many bilingual US crews use them. Stored values stay as they are either way.

Decided by default (Nov 5, for Kevin to review; Kevin asked for the easy-to-undo ones to be taken this way):
- The Layout menu's Open tile lists only built tiles (Trash, History, Color script and the Storyboard's own); a
  phase's placeholder stays in the default layout it belongs to, and Reset to default layout brings it back if closed.
  Built: one filter in LayoutMenu.tsx. Notifications, in no default layout, shows nowhere until Phase 3 builds it.
- The role list (src/core/model/role.ts) stays as built; roles are stored by id, so adding one later changes nothing.
- An approval stays one sign-off by the director or the DP. The file keeps a list of approvals, so "both must sign"
  is a change of rule, not of format.
- The department status colours stay the kit's navy, mustard and sage. They match the department tags' colours, but
  no screen shows a department tag today (only the developer catalogue), and every status carries its own shape.
  Revisit when tags come back on screen (Phase 3's department workspaces) and when the plan icons, drawn in the same
  colours, reach the bird's-eye view (Phase 6). Changing them is the three state-* tokens in src/ui/theme.css (four
  values with dark mode's Seen; Done's glow follows its token).
- Not decided, for Kevin (decided Nov 5: names recorded, see PE below): whether each edit carries who made it (the op
  and op group `author`, still `local`, so History reads "You"). Written into the append-only log, a name stays there for good, so it can't be taken back once
  shipped. Note that one name is already in the file: since P6a an approval keeps the approver's profile name and
  role, as the brief's "showing who" asked, and each Approved tick is an op, so that name is in the log too.

P1 as built (Nov 4):
- The app's words live in one file per language, src/core/i18n/locales (English: `en.ts`). Code reads them through
  `t()` and `tn()` (counted phrases, by the language's plural rules); a language is one file plus one line in
  `LOCALES`. No dependency: plain functions, since notices, History lines and exports are built outside React, and
  the app's root re-renders on a change of language.
- The language is the person's (Settings → App, a new App tile beside Project), never the project's: a shared .sbd
  opens in each person's own language. A saved language this version doesn't have opens in English.
- Errors raised below the UI (the Rust commands, the storage drivers that stand in for them) stay English, so every
  driver says the same and `CHANGED_ON_DISK` still compares; they're translated where they're shown, from the
  `error.*` entries. A test fails when a Rust or driver message has no entry.
- Stored values never change with the language: a shot's size stays `MCU`, a scene's time `NIGHT`, a support
  `sticks`, and a script's scene name keeps the script's words; only how they read does. File names other tools rely
  on (backups, `SC004_4A.png`, "(from backup)" copies) stay as they are, so editors and the backup pruning find them
  in any language. Export names ("Bey County storyboard.pdf") and a new project's "Untitled" follow the language.
- Dates and times keep the computer's own format in English, as before; another language writes them its own way.
- A tile added to a default layout joins a layout people saved earlier once, as a tab (Settings: App beside
  Project), so it shows without a reset; closed after that, it stays closed.
- A test fails on any word in a screen that doesn't come from the translation files (the dev-only UI catalogue
  aside), and on any English entry the code no longer uses.

P2 as built (Nov 4):
- Hide sidebar sits at the sidebar's foot, bottom left; ⌘\ (Ctrl+\) does the same from anywhere outside a modal
  dialog. Hidden, the sidebar leaves a 36px strip with Show sidebar in the same corner (PC adds the gear and the
  profile there). Tab still goes from the switcher to the active section.
- Focus follows a click to the button that brings the sidebar back; from the keyboard it moves only if it was in what
  folded away. Alt+1 to 7 keep working while it's hidden, and focus lands on the new workspace itself. A held key
  toggles once, and nothing toggles mid-drag or in a modal dialog.
- Hidden, the project switcher (All projects…, New project…) is out of reach until the sidebar shows again. PC
  decides whether the strip keeps a way to it, beside the gear and the profile.
- The choice is the person's (`sidebarHidden` in their settings), remembered across restarts.

P3 as built (Nov 4): a History button (a clock glyph and the word) right after the project's name in the top bar,
disabled with no project open. It opens the History tile in the workspace on screen, or brings it to the front, as
the project menu's History does.

P4 as built (Nov 5): dragged past the tiles (into the gap around them, over the top bar or the status bar, or to the
window's right edge) a tile docks along that whole side at a quarter of the space; inside the tiles each tile's own
zones apply as before, so a tile let go on its own title bar stays where it was. Nothing to the left of the tiles
docks: that side is the sidebar's. What the tile leaves is shared among its neighbours by their sizes, so the rest
keeps its proportions, and a tile already along that edge stays exactly as it is. A keyboard move offers the window
after every tile; the arrows pick top, right or bottom, Left and Space say why they can't. A workspace's only tile,
or a maximized layout, has no edge to dock to. A top or bottom dock redraws the workspace's tiles, so a tile's
scroll position starts over (to revisit if Phase 2's player minds).

PB as built (Nov 5):
- One in-app window (src/ui/InAppWindow.tsx) on <dialog> opened modal: a tile's 26px title bar and close button,
  focus on its first control, Tab kept inside, Escape closes, focus back where it was. Export and Watermark Settings
  use it. Import script, onboarding and the sketch editor were in-app modal dialogs already and keep their own look.
- Settings is that window, not a workspace: Project, App, Theme, Backups and Storage as tabs, opened with ⌘, or from
  the sidebar's Settings… (PC moves it to the gear). The sections are six, Alt+1 to 6. A saved layout that held a
  Settings tile keeps its other tiles where they were.
- The system's message boxes are gone: Empty Trash, Clean up old pictures, Delete version and "open on another
  computer" ask in the app's own window (src/app/ask.tsx), the safe choice first. The Tauri `dialog:allow-message`
  permission is dropped; only the native Open and Save pickers remain.
- Not built: Manage workspaces, until Phase 3 (Kevin, Nov 5).

PC as built (Nov 5):
- The sidebar's foot: Web version (muted, Phase 9, focusable but going nowhere: the site still shows the prototype),
  then Hide sidebar, the Settings gear and the profile. The temporary Settings… entry from PB is gone, and CLAUDE.md's
  navigation says so. Folded, the strip keeps the profile and the gear above Show sidebar; the project switcher stays
  out of the strip, as Kevin listed it, and is one click away once the sidebar shows.
- The local profile (name, initials, usual role) lives in the person's settings and is edited in Settings → Profile,
  which the profile button opens. Roles are kept by id (src/core/model/role.ts) for P6's approvals.
- (Superseded by PE, Nov 5: edits now carry the profile's name.) The profile stays in this computer's settings, and
  History's steps still read "You" (ops keep `author = local`). Writing a name into every op would put personal data in the append-only log
  for good, so it waits for Kevin's call at review stop 1: names in the file or not, and if so as a stable profile id
  with the name beside it (renames and shared names stay one person) rather than the bare name.
- For stop 1 too: the role list (src/core/model/role.ts) before P6 saves role ids in settings and approvals.
- A project's own "Your role" comes with P6, in Settings → Project, and takes the place of the usual role there.

PA as built (Nov 6): the Layout and project menus in labelled groups, as DESIGN.md's Menus lists them, with the rules
Kevin set on Nov 5. Menu primitives in src/ui/Menu.tsx (MenuGroup, MenuItem, commandShortcut). New shortcuts: ⌘⇧H
History and ⌘E Export (Ctrl elsewhere), not inside a window of the app's. Maximize tile acts on the tile that last
held focus. The sidebar's hidden state moved to a store of its own, shared by the button, ⌘\ and the menu. "Update
“Storyboard”" is now "Save layout", and Watermark Settings… carries its "…".

P5 as built (Nov 5): a bin button on each row of the Scenes tile, and Delete (or Backspace) on a focused scene row or
sidebar scene, send the scene with its frames and notes to the Trash as one step (trashScene in board.ts, shared by
both through src/features/storyboard/deleteScene.ts). No confirm: nothing is lost, and the notice says how to undo it.
Focus moves to the scene that took its place (+ New scene in the tile, or the Storyboard section, once none is left);
the active scene moves with it. The Trash lists the scene as one row with its frames, and Restore brings them all
back. A frame already in the Trash stays its own row; its Restore brings the scene back whole. One delete per press
and per click: a held key or a double-click never runs on into the next scene. A locked scene's slate numbers stay
used through delete, restore and undo, and a new scene never takes a deleted one's number.

P6a as built (Nov 5): P6 is two PRs, to keep each reviewable. The inspector's department tags became a grid: a row
per department, Priority first, with boxes for Priority, Working on it, Done and Approved (src/core/model/
departmentStatus.ts, src/features/storyboard/DepartmentStatusTable.tsx). Each tick is an edit; History lists each
department's change on its own and never offers one to put back (an approval is a sign-off). Approved: only the
director or the DP (or one person who is both, counted once), with their profile name and role; each sign-off is
its approver's to take back, and the director's and the DP's can sit side by side. "Your role on this project" in Settings → Project, kept on this computer by project (like the profile), takes
the place of the usual role there; its list adds "Director and DP". Schema 6 turns each department that was on into
Priority, after a backup. The shot list and the CSV list the Priority departments for now; P6b adds Seen and the
compact summary. Status colours from the kit as `state-*` tokens (navy, mustard, sage), each with its own shape.

P6b as built (Nov 5): Seen. A frame open for 0.6s (arrowing past doesn't count) is marked seen by the departments
the person's role on the project stands for (the DP: Camera; Director and DP: both), from any tile. Kept in a table of
its own (schema 7, `shot_seen`), not an op, so undo never takes it back; Empty Trash deletes it with the frame. The
inspector's grid gains a Seen column (read-only). Frame cards get a summary line (a shape and a count per state), the
shot list each department with its shapes, and the CSV each department with its states in words.

PPa as built (Nov 5): palettes are a scene prop (`palette`, no table change). Generate reads each frame's stored
thumbnail as it's framed (its crop, the project's aspect ratio) onto an sRGB canvas, so a Display P3 picture comes out
colour-managed; letterbox and pillarbox bars are left out; every frame weighs the same; colours are clustered in OKLab
(the project theme's k-means) and kept at least three just-visible steps apart, the ones covering most of the scene
first. Regenerate keeps locked colours in their places. Edited in the inspector under the scene; a 2px strip on the
scene's row in the Scenes tile. PPb adds the Color script tile, the eyedropper and the PDF option.

PPb as built (Nov 5): the Color script tile (in Open tile; in no default layout) lists every scene in script order
with its palette, a row opening its scene. "Pick from a frame" turns on an eyedropper: a click on any frame's picture
(board, strip or inspector) adds the colour under the pointer, read by the app (5 by 5 pixels averaged, colour-managed
onto sRGB) since WebKit has no EyeDropper API; Escape stops it; a typed hex is the keyboard's way. Export's PDF
storyboard can print each scene's palette as swatches in its heading, a choice remembered on this computer.

P7 as built (Nov 5; merged with the glossary as built, at Kevin's word: his word changes come as a small follow-up PR): Español (Latinoamérica) in Settings → App
(src/core/i18n/locales/es.ts, tag es-419 for plurals and dates), every key English has. The choices Kevin may want
otherwise are in docs/i18n/es-glossary.md, shot size abbreviations first. Script import also reads Spanish headings
(INTERIOR/EXTERIOR in capitals; DÍA, NOCHE, AMANECER, ATARDECER, HORA MÁGICA and more). An e2e sweep checks that no
button, tab, label or title overflows in Spanish; a unit test keeps every PDF word inside the page.

P8 as built (Nov 5): e2e/visual.spec.ts runs again everywhere `npm run e2e` runs, and at every checkpoint beside the
smoke set. Three screens (the shell with no project, the board with a frame selected and its inspector, and Settings
over the board), each in light and dark, English and Spanish: 12 screenshots per browser and OS. Windows Chromium
baselines come from the Windows gate; the Linux and macOS ones from a push to `checkpoint/baselines-<name>`, which
regenerates them and hands them back as artifacts to commit. Every baseline was looked at before it was committed.
Looking found one Spanish fit the overflow sweep had missed (the Scenes tile's coverage label ran into its figure).

Q1 as built (Nov 5): the lows the reviews left open, fixed.
- An edit that fails to save now says so wherever it was made (a warning notice), not only in Settings → Project.
  Found while building the 300-frame project: a drop of 30 pictures failed to save and the board showed nothing.
- Undo and redo clear an info notice about the step they took back ("Locked SC 04 …", "Deleted SC 03 …").
- A relock after an unlock says frames take back the numbers on their slates, not that they dodge a clash.
- Restoring a frame from the Trash again, after its first restore was undone, gives it back the number it was slated
  with, not a new letter. Renumbering edits (scene number, deleting a frame, the I and O setting) all take the slate
  numbers. A v4 file's migration writes each frame's slate numbers in the order it held them, so a relock gives back
  its later number.
- Compact project keeps the lock file fresh every minute while it runs, so a long one never reads as stale to another
  computer. The Node test driver checks for a file replaced during compaction as the desktop does.
- A notice is read out once: drawn again as windows open and close, it shows without a second announcement.
- Docking a tile along the top or bottom keeps where each tile was scrolled to.
- Spanish: History never names a record by its English type; export names follow the language's word order ("lista
  de planos de Bey County ESC 04.csv"); the PDF glyph test checks accented letters; script import reads headings with
  full stops between the parts (`INT. CASA. NOCHE`).
- Checked and already fixed: ⌘, with a menu open closes the menu (now tested).

Q2 as built (Nov 5): two performance checks, run on request (`SB_PERF=1`; in PowerShell `$env:SB_PERF='1'`), two
fixes, and the numbers (Windows PC, Chromium, every frame with its own 1920 by 1080 picture).
- `e2e/perf.spec.ts`, the screen side, in the memory build with the project kept in the page ("saved" there means
  written to sql.js in the page, no file, no Rust calls). At 300 frames (10 scenes of 30): scrolling the whole board
  (20,000 px) keeps the page's frames at 16.7 ms, the first time too, while its pictures load (every one checked
  loaded after); Grid, Strip and Shot list are drawn in 59 to 87 ms, with the pictures in view shown by 77 ms; back to
  the Storyboard workspace 75 ms; the next frame with → 27 ms; an edit saved and shown 30 ms; undo and redo about 70 ms
  as the test sees them; opening from Recent 0.32 s; 30 pictures dropped at once about 2 s to prepare and save.
- At a feature film's shape, 960 frames in 120 scenes (`SB_PERF_SCENES=120 SB_PERF_PER_SCENE=8`): the next frame 81 ms,
  an edit 107 ms, undo about 210 ms, Grid and Strip 250 to 350 ms, opening 0.85 s; scrolling still 16.7 ms a frame.
- `src/core/storage/perf.test.ts`, saving on native SQLite (the desktop's engine, without the window) at 300 frames: an
  edit 13.7 ms, undo 12.9 ms, redo 12.8 ms, opening 17 ms, for a 98 MB file.
- Fixed: the board's scenes read their frames from an index built once per change, not by scanning every record for
  each scene (at 960 frames that halved the next frame, the edit and undo); and an edit reads the records it changes
  in one query rather than one each (each one is a round trip from the window to Rust on the desktop: a 30-picture
  drop was 60, renumbering a long scene hundreds). The memory build's driver was slow too (1.5 s an edit), a dev-only
  tool, fixed in #64.
- Next if boards grow past a few hundred frames: every card is drawn again on each change (the rest of the 960-frame
  times); drawing only the cards that changed would cut most of them. Not measured: the desktop's calls from the
  window to Rust themselves.

Q3 as built (Nov 5): e2e/a11ySweep.spec.ts goes through every screen in light and dark, English and Spanish: the
shell, onboarding, the board's three views with a frame selected, the inspector with a picture (framing, the scene's
palette, a field's warning), the slash menu, the sketch editor, every workspace, both menus, the History, Trash and
Color script tiles, the Empty Trash question, every Settings tab, Export, Watermark Settings, Import script and the
Projects screen. On each: axe's WCAG 2.2 A and AA rules; contrast axe can't settle worked out against the fill behind
the text and held to AA; and a walk with Tab from the screen's first stop, every stop showing its ring, not covered,
and focus never falling to nothing.
- Found and fixed: at the end of a Tab cycle focus fell to nothing (a browser hands it to its address bar; the desktop
  webview has none, so a keyboard user lost their place). Tab and Shift+Tab now go round the page, or the window on
  top (src/ui/tabWrap.ts), in the desktop and dev builds; a plain browser build (the web companion) keeps the
  browser's own Tab. A narrow tile's title, and its tabs, now shorten rather than push its close button out under the
  next tile's grip (axe: target size, in Spanish with several tiles open).
- For Kevin, on the Mac: with macOS's Keyboard navigation off (the default), Tab skips buttons, so the wrap may not
  trigger from the last text field of a window; Option+Tab is handled. Try Settings → Profile, Tab past the last field.
- Not covered by the sweep yet: stacked tabs in a narrow tile, the hidden sidebar's strip, a maximized tile, the
  keyboard tile move, a note being edited, the archived banner. Truncated tile titles pass this sweep but the Spanish
  sweep (e2e/spanish.spec.ts) counts any cut-off label as a failure; it opens one tile at a time, so both hold today.

Decided Nov 5, after the meeting run (Kevin):
- Who made each edit: recorded, with the profile's name; a profile option shows only the initials; Settings → Profile
  says people you share a project with can see it in History. Older edits stay without a name. (PE, below.)
- The defaults marked for review in PD stay as they are.
- Phase 8, before the public release: stop every card redrawing on each change (the 960-frame times in Q2).

PE as built (Nov 5): every edit, undo, redo, History restore and Empty Trash carries who made it in the file's
existing `author` columns (and a deleted item's `trashed_by`): the profile's name, or its initials with "Sign my edits with my
initials only" on, read as each edit is made. With an empty profile it stays `local`, as every edit before this
did, and History shows no name for those (the step's time only; a dash in an item's own history), where it used to say
"You". An approval is signed by the same rule (initials only when chosen), Open version signs the restore step it
makes in the copy, and a named version records who named it. No table or column changed, so there's no migration and no backup step: an older file reads as before, and an
older build shows the names as they're written. docs/SBD_FORMAT.md says what the column now holds.

PT as built (Nov 5): a pencil beside every scene name and frame title (the board's scene headings, the Scenes tile's
rows, the frame cards, the inspector's header), shown on hover and on keyboard focus, never inside the button or
heading it names. A click, or F2 on a frame, makes the text a field in place: Enter saves, Escape puts it back, leaving
saves; each save is one edit, so one undo. A frame's title is a new shot prop, `title` (no table change, so no schema
bump; Phase 2's schema 8 is for video), shown under its number on the card. Not in this milestone: the sidebar's scene
list (navigation, left as it is) and a Title column in the shot list.

Later phases, added Nov 4 (not built now):
- Phase 3: project details (title, logline, format, runtime, key crew) and an optional production company. Company
  profiles are saved once in the app's settings and can be attached to any project; attaching copies the details into
  the .sbd, so a shared file carries them. Phase 4's call sheets pull from these.
- Phase 3: a workspace per department, opened from that department's row on a shot, showing its view of the shot and
  the scene.
- Phase 5 (canvas flow): scene palettes can also be generated from a scene's moodboard, and exported as swatches (a PNG strip and
  Adobe .ase) with decks.
- Phase 9: a view for each team member on the web companion, with Seen set automatically per person.

Testing from Nov 4: every PR runs quick checks on Linux (lint, types, unit tests, Rust tests, the Rust data-safety
tests among them), and a newer push cancels the outdated run. The end-to-end smoke set (create, open, add a scene and
frames, undo, save and reopen; e2e/smoke.spec.ts) and the installers run at checkpoints (checkpoint.yml). The deeper
end-to-end specs run locally before each merge. A failing functional or data-safety test gets fixed, never skipped.

### Phase 0 milestones

One PR per milestone, each into `v2`.

| Milestone | PR | State |
|---|---|---|
| 0.1 Archive the prototype (password gate removed), add CLAUDE.md, PLAN.md and the PDF | pushed to v2 | Done |
| 0.2 Scaffold: Vite, React, TypeScript, Tailwind, Tauri 2, ESLint, Vitest, Playwright | #2 | Done |
| D1 Design foundation: kit tokens, bundled fonts, logo, UI primitives, empty app shell in light and dark | #3 | Done |
| 0.3 CI: checks on every push; Mac and Windows installers on PRs | #5 | Done |
| 0.4 .sbd storage: Rust commands, schema v1 (records carry trashed_at and trashed_by), migrations, backups every 5 minutes with pruning, docs/SBD_FORMAT.md | #7 | Done |
| 0.5 Operations, undo and redo, autosave; deleting moves a record to the Trash, and restoring is an op | #8 | Done |
| D2 Dockable tiles on pointer events: split on a tile's edges, tab on its center, splitters that snap, maximize and restore, saved workspaces, keyboard moves, open any tile in any workspace (needs 0.5) | #9 | Done |
| 0.5b Append-only History: undo, redo and restore are op groups of their own; restore to any point; schema 2 | #10 | Done |
| D3 Navigation: left sidebar (project switcher, then Storyboard with its scenes, Assets, Team, Setup, Production, Moodboard, Settings), each section a workspace; the project menu (History, Watermark Settings, Export Project, Archive Project). Sections and menu items show their phase until built | #11 | Done |
| 0.6 Double-click opens a .sbd (Mac and Windows) | #12 | Done |
| 0.7 Projects screen: New, Open, Recent, Open backup; backup settings; project state (draft, active, archived) and Archive Project; the switcher lists recent projects, and switching opens a project in place without a reload | 0.7a #13 (Projects screen, switcher); 0.7b #14 (Open backup, backup settings, project state) | Done |

Phase 0 calls, Nov 1 and 2, 2026:

- The .sbd is accessed through custom Rust commands (rusqlite), not tauri-plugin-sql. One command runs a batch of
  statements in a single transaction, and image bytes travel raw instead of as JSON.
- CI runs lint and tests on Linux for every push. The Mac and Windows installers build on PRs and on pushes to `v2`,
  which saves private-repo macOS minutes.
- Vercel skips `v2` and every branch made from it: their vercel.json turns deployments off, and `main` has none, so
  the prototype site stays live (Nov 2).
- Design system: Kevin's design kit arrived Nov 2, 2026 and lives in `design/` (DESIGN.md, tokens, logo). D1 builds it
  into the app. At Kevin's request the shell comes before CI (0.3); docking (D2) waits for operations (0.5).
- Docking (D2) is built in-house on pointer events, with no library, so Tauri's own file drop keeps working on Windows.
  No floating windows. Saved workspaces live per user in settings, with built-in defaults, so the .sbd doesn't change.
  D2 is one milestone; if it runs longer, Claude Code stops and shows Kevin where it stands (Nov 2).
- @axe-core/playwright is added as a dev dependency for automated accessibility checks (Nov 2).
- Backups join 0.4 and 0.7, and the archive columns (now the Trash's) join schema v1. The Archive tile (now the Trash
  tile) comes in Phase 1, the Calendar and Notifications tiles in Phase 3, and all three on the web in Phase 9
  (Nov 2). Open questions are under Decisions.
- Second round (Nov 2): navigation (D3) and Archive Project (0.7) join Phase 0. Project themes, onboarding, History,
  named versions and export go to Phase 1; the review screen for change files to Phase 7; the web side to Phase 9.
  The item archive is renamed the Trash, and one model replaces snapshots. Details under Nov 2 features, round two.
- D2 as built (Nov 2): layouts live in the person's settings, not the .sbd, so layout changes can't be ops. They
  undo for the session from the Layout menu (Undo layout change, per workspace); ⌘Z undoes project edits only, and
  survives restarts (Kevin, Nov 2). The four workspaces stay until D3 makes them the sidebar sections.
  Custom workspaces (+ Workspace, Save as…, Duplicate, Manage) wait for D3, since the sidebar fixes the set.
- Undo never destroys history (Kevin, Nov 2): the edit log is append-only. Undo, redo and restore are op groups of
  their own, linked to the group they undo, redo or restore to; a new edit after an undo ends the redo stack, but the
  undone work stays and can be restored. Restore to any point is built in 0.5b with tests; the History panel that
  lists every step and restores from any point stays in Phase 1. The schema change (schema 2) was approved.
- D3 as built (Nov 2):
  - The seven sections are the workspaces, so Alt+1 to Alt+7 follow the sidebar. Setup takes the old Bird's-eye
    layout, and Production takes Call sheet's (shoot days, call sheet) plus calendar, locations, gear, and cast and
    crew. New placeholder tiles: Assets, Team, Cast and crew, Settings.
  - Sections still to come open their workspace of placeholder tiles, muted and showing their phase, as DESIGN.md
    says; only project menu and switcher commands are disabled until their phase.
  - The switcher shows the open project. Its recent list and switching in place come with the Projects screen (0.7);
    until then All projects… and New project… show 0.7.
  - The Layout menu sits in the top bar beside the project menu, and the unsaved-layout dot moved to the section.
  - Layouts saved under D2's four workspaces start over (a new settings key); nobody has used them outside testing.
  - Scenes list under Storyboard, and + Add Scene creates the next scene number as one op. Nothing opens a project
    until 0.7, so the list is tested against a project file in unit tests. Setup's setups by scene come in Phase 6
    with setups, and the status bar's unread count in Phase 3 with notifications.
- 0.6 as built (Nov 2): the installers register .sbd as "Storiiboard Project" (macOS type `app.storiiboard.project`,
  the app as its owner). A double-click arrives as an Apple Event on a Mac and as a launch argument on Windows; with
  the single-instance plugin (approved Nov 2), a second launch on Windows hands its file to the running app. Either
  way the file opens in place of the open project, which stays open if the new file can't be opened, and the reason
  shows in an alert. CI checks the association in the built Info.plist and in the Windows installer scripts.
- 0.7 is two PRs, each small enough to review (Nov 2). 0.7a as built:
  - The Projects screen is one tile: New project… (the native Save dialog picks name and folder, starting in
    Documents), Open…, and Recent with each project's path and when it was last opened, the open one marked, and
    Remove from Recent. It shows when the desktop app has nothing open, and from the switcher's All projects….
  - The switcher lists the last 8 recent projects; picking one switches in place. New project… is there too.
  - An open project now shows its workspaces. Its title and notes, Phase 0's edit surface with + Add Scene, moved
    into a Project tile in the Settings workspace, beside the Backups tile 0.7b fills.
  - The browser build can't open files: it keeps the placeholder workspaces, and the switcher says projects open
    in the desktop app. The Projects view is drawn in the UI catalogue so the axe checks cover it.
  - The dialog plugin (tauri-plugin-dialog 2.8.3) was approved Nov 2. Only its Open and Save dialogs are allowed, and
    its message dialog from Rust only to confirm a new host for one's own tile server (Kevin, Nov 10, 4.9).
- 0.7b as built (Nov 2):
  - Open backup copies the backup beside its project as `<backup name> (from backup).sbd` (numbered if opened
    again) and opens the copy, so the backup itself is never edited and pruning can't take work with it. It's on the
    Projects screen (Open backup…, a file dialog) and in the Backups tile, which lists the open project's backups.
  - Backup settings live in the Backups tile in Settings: keep the last N copies (1 to 500, default 12) plus one a
    day for N days (0 to 365, default 14). They belong to the person and apply to every project at the next backup.
    Back up now is there too.
  - Project state: new projects start as drafts. The Project tile has Draft, Active and Archived; the project menu
    has Archive Project and Unarchive Project. Each is an op, so ⌘Z takes it back. An archived project shows a
    banner, leaves the switcher and moves to Archived on the Projects screen. Recent keeps each project's state.
  - The Settings section is built, so it no longer shows a phase.
- Kevin's round-two decisions (Nov 2): every sidebar section is a workspace, and a Production section (schedule,
  calendar, call sheets, locations, gear, cast and crew) sits between Setup and Moodboard; DESIGN.md updated. The
  default theme's accent is #DF5E27 and the logo keeps #E0612B as a fixed brand token. An optional view-only link is
  allowed. The Trash and the history model stand.

---

## Vision and positioning

**Mission:** give people in film and content production the tools for their projects without depending on a handful of
corporations and subscription sites. The tool is theirs: it runs on their machine, their projects stay in their own
folders, and the code is open for them to change.

Storiiboard 2.0 makes storyboarding fast, and every frame connects straight to production: each shot knows its scene,
location and shoot day, so schedules, shot lists and call sheets build themselves from the boards. References and decks
support the storyboard; they are not the center.

Canva and Milanote are general tools. Neither knows what a shot, a lens or a location is, so filmmakers rebuild the same
information three times: moodboard in Milanote, deck in Canva or Keynote, shot list in a spreadsheet. That gap is the wedge.

- **Against Milanote:** references on the board become structured frames with shot metadata, not loose images.
- **Against Canva:** decks and treatments are generated from the frames and board, with film-native templates
  (treatment, lookbook, director's pitch, one-pager).
- **Against both:** the same data exports as a shot list and feeds call sheets, so pre-production has one source of truth.
- **Against StudioBinder and spreadsheets:** call sheets are built per shoot day from the project itself, with weather,
  sunrise, golden hour and maps pulled in automatically.

**Who and how:** built for filmmakers, producers and creators. Kevin uses it first on real jobs (Bey County is the natural
pilot), then releases it as a free, open-source desktop app for Mac and Windows. Projects live on the user's own drive,
saved automatically, with no account or server. Anyone can run it, fork it and improve it; Patreon funds the work.

## Where the repo stands (before v2)

The `mtsm-ph/storiiboard` repo is a strong clickable design prototype, not an app: keep it as the visual spec and rebuild
on a real foundation. Last prototype commit: April 27, 2026.

| Area | Finding | Implication |
|---|---|---|
| Size | About 3,100 lines: index.html plus 7 JSX files | Small enough to port screen by screen |
| Build | React 18 and Babel loaded from a CDN, compiled in the browser; no package.json | Needs a real Vite + TypeScript scaffold |
| Data | Every screen runs on hard-coded mock data in component state | Nothing saves; refresh wipes everything |
| Backend | No Supabase, auth or storage yet, despite the original spec | Whole data layer is new work |
| Canvas | No Konva or canvas engine; boards are styled divs | Board and deck editor are new work |
| Screens | Projects, storyboard frames, pitch mode, pitch deck generator, moodboard, assets, crew, calendar, notifications, history, producer panel, settings | Good UI reference for Phases 1 to 4 |
| Access | Password gate checks a password written in the page's own JavaScript | Anyone who views source can read it; treat it as no protection |

**First fix in Phase 0:** remove the client-side password and change it anywhere else it is reused. A local desktop app
needs no login at all, so the gate simply goes away.

## Product scope

Three parts: a **desktop app** where production decisions are made, a **web companion** where everyone else sees what they
need, and an **AI assistant** that connects through MCP. The desktop app owns the project. The web gets a compressed
snapshot and sends feedback back for approval.

### Desktop tools

| Tool | What it does | Main users | Can we build it |
|---|---|---|---|
| Storyboard (core) | Scenes and frames; each frame takes an image, photo, sketch or video still; shot size, lens, movement, INT/EXT, action, dialogue; auto shot numbers; keyboard-first | Director, DP | Yes |
| Video player and frame capture | Play footage and references frame by frame; set in and out; crop; grab a still or short clip straight into a frame | Director, DP, editor | Yes. Footage gets a light playback copy, because Mac and Windows play different formats natively |
| Image attachments | Attach images, PDFs and links to any shot, scene, location or person | Everyone | Yes |
| Bird's-eye view | Top-down plan per setup: walls, doors, windows, set pieces, cast marks and movement, cameras with true field of view from lens and sensor, lights with type and beam, flags and diffusion; a layer per department | DP, gaffer, key grip, art department | Yes. 2D first; it is the largest new tool |
| Locations | Address lookup, map, photos, contacts, parking and power notes | Producer, AD, location scout | Yes |
| Cast and crew | People, departments, roles, characters, contacts | Producer, AD | Yes |
| Gear lists | Camera, lighting, grip and sound packages per day, linked to the shots that need them | DP, gaffer, sound | Yes |
| Schedule | Shots grouped into shoot days by location and setup | AD, producer | Yes |
| Calendar | Month and week views of shoot days and availability, plus the shoot schedule as a list. Kept from the prototype: Today, picking a day narrows the list, and each day shows its scenes, its location's status (TBD, confirmed, cancelled) and how many crew have confirmed | Producer, AD | Yes |
| Call sheets | Document built per day that links cast, scenes, locations, gear, crew by department, sound, weather, sun times, map and nearest hospital; PDF and web | AD, producer | Yes |
| Moodboards by department | Boards for creative direction, set design, makeup and wardrobe, linked to scenes and characters | Creative director, production designer, HMU, wardrobe | Yes |
| Pitch decks | Decks and treatments built from frames, with film templates | Director, producer | Yes |
| Cloud links | Paste a Dropbox or Google Drive shared link per project; the app lists the files, downloads them and relinks media | Everyone | Yes for public links; private folders need sign-in later |
| Find missing files | Search the computer for media that moved or was never linked, matched by name, size and length | Everyone | Yes, later phase |
| Backups | Every 5 minutes, if anything changed, a full copy of the project goes to a Backups folder next to it. The last 12 copies and one a day for 14 days are kept; Open backup opens one as a separate project | Everyone | Yes |
| Trash | Deleted frames, shots, scenes, notes and media, and deletions approved in review, wait in the Trash: filter by scene and type, restore with one click, empty it after a confirm | Everyone | Yes |
| History and versions | Every change to a frame (field, before and after, who, when), with restore; name a version and open it later as its own project | Everyone | Yes |
| Project themes | The app takes its colours from the project's logo or key image, worked out on the computer, readable in light and dark | Everyone | Yes |
| Export | Per scene or whole project: PDF storyboard, PNG image sequence, shot list CSV, with a watermark | Director, DP, producer, editor | Yes |
| Review | Suggestions from the web (a change file) and from the AI assistant, approved or rejected one at a time | Director, producer | Yes |
| Notifications | One feed of what changed, who changed it and when, from edits, suggestions and comments, each linking to its item; read and unread per person. Kept from the prototype: an unread count, filters for All, Unread and the current scene, and Mark all read. Filtered to one frame, the feed is that frame's history (field, before and after, who, when) | Everyone | Yes |
| AI assistant | Reads the whole project, checks for mistakes, drafts changes for approval | Producer, AD, director | Yes, through MCP |

Calendar, Notifications and Trash are tiles you can open in any workspace; they aren't in the default layouts. An
archived project is a different thing: a project's state, set with Archive Project.

### Script and 3D tools

The 3D set stays light inside Storiiboard: simple blocks you can look through each camera at. Anyone who wants more opens
the scene in Blender on their own computer, so heavy 3D work never runs on a server or on machines that can't handle it.

| Tool | What it does | Main users | Can we build it |
|---|---|---|---|
| Script import | Read a Fountain, Final Draft (.fdx) or PDF script and create a shell for every scene: number, INT/EXT, location, DAY/NIGHT, speaking characters, estimated page length. Locations and cast roles are created along the way | Director, AD, producer | Yes. Scene headings follow fixed rules (Fountain syntax), so this works without AI |
| Script breakdown | The AI assistant reads each scene and tags props, wardrobe, vehicles, stunts and VFX, as suggestions to approve | AD, producer, departments | Yes, through MCP |
| 3D set preview | Turns the bird's-eye plan into simple 3D: walls raised to height, cast as plain figures, lights as icons with beam cones. Look through any camera at its real field of view | Director, DP, gaffer | Yes. A light blockout runs on an ordinary laptop |
| Open in Blender | Export the set as glTF (an open 3D format with cameras and lights), then build a .blend with a camera per setup, real light types and a collection per department, using the Blender already on that person's computer | DP, gaffer, art department | Yes |
| Simple Blender layout | A Storiiboard startup layout for Blender that hides most of the interface and keeps the few tools a DP needs: move, rotate, camera view, lens, lights | Anyone new to Blender | Yes, through Blender's application templates (manual) |
| AI in Blender | An existing community MCP server lets Claude control Blender directly (blender-mcp). With Storiiboard's MCP it can build or adjust the scene from the plan | Advanced users | Yes, optional. It can run any code inside Blender, so save first |

**As built in 1.17 (Nov 3): script import, Fountain and Final Draft** (src/core/script, src/features/script):
- Import script… in the Scenes tile opens a Fountain (.fountain, .spmd, .txt) or Final Draft (.fdx) file. In the
  desktop app it comes from Rust's Open dialog and is read only because it was picked.
- Headings are read by rule: INT, EXT, EST, INT./EXT. or I/E, then the place, then the time of day after the last
  dash. DAY, NIGHT, DAWN (or SUNRISE), DUSK (or SUNSET) and MAGIC HOUR become the scene's DAY/NIGHT; any other time
  (CONTINUOUS, MOMENTS LATER) stays in the scene's name after the place. A forced heading without INT or EXT
  (`.FLASHBACK - THE BRIDGE`) keeps its whole text and gets no location.
- Speaking characters come from character cues, without extensions such as (V.O.) and (CONT'D). Length is Final
  Draft's own where it has one, otherwise estimated from printed lines (55 a page), at least an eighth.
- A preview lists every scene (number, heading, length, speakers) and what will be created. Import writes the scenes
  after the board's last, with their locations and characters found by name (any case) or created, in one op group.
- Decided while building, to review:
  - Every number the script prints is kept, exactly, as on the slate. A scene it doesn't number gets the number the
    board would give it there: between a printed 1 and 2 it's 1A, after the last it's the next whole number. A
    number printed twice, or one that can't be a scene number, is numbered the same way, and the preview says why.
  - A scene counts as "On the board" only when the board's scene with its number has the same INT/EXT and place, so
    importing the same draft again adds nothing. A printed number the board has for a different scene ("Number taken
    on the board"), or one in the Trash ("Number in the Trash"), is left out rather than renumbered off the slate. A
    scene the script doesn't number has no slate number to keep, so it's numbered around the board's instead. A revised script's
    changed scenes aren't merged; that needs the review screen of Phase 7.
  - Scenes are added after the board's last scene, in script order, rather than slotted between existing ones.
  - Character records hold only `name` until Phase 3.

**As built in 1.25 (Nov 3): the PDF storyboard** (src/features/export/pdfStoryboard.ts, pdfStoryboardFormat.ts):
- Storyboard (PDF), the format Export starts on: US Letter landscape, three frames a row, each scene under its heading
  (number, heading, length) and carried on to the next page as "(continued)". Under each frame: its shot number as on
  the slate, status, size, lens and stop, three lines of action and two of dialogue, cut with … when they run on.
  Title and STORYBOARD at the top of every page, the date and "2 / 5" at the foot, and the watermark when it applies
  to PDFs.
- Real text and lines from pdf-lib, so the file is small and searchable (an editor can find "4B"); each frame goes in
  as a JPEG drawn the way the PNG export draws it, at three pixels per point of its printed size (216 ppi; about
  700 pixels wide), so a feature-length board stays small enough to send. Inter Tight and JetBrains Mono are embedded as
  subsets, from static copies of the bundled fonts made by scripts/static-fonts.py (fontTools, run once by hand; not
  a dependency). pdf-lib and the fonts load only when a PDF is exported.
- Dependencies, as approved: pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1, both MIT.
- Decided while building, to review: Letter only (A4 and frames per row can be settings later); frames print on white,
  as the PNGs do; a frame without a picture is an empty box with its caption; a centred watermark is set at 15
  degrees, the others flat in their corner.
- Fixed in review (Nov 4): a frame is capped so its row always fits under a heading (a 9:16 frame is 386pt tall and
  narrower than its cell, rather than a row a page that ran off the foot); the footer's date is this computer's day,
  not UTC's; a word wider than its cell (a URL) is cut at the edge; the centred watermark turns about its own middle
  and shrinks to fit inside the margins; status prints as its shape and name (■ Have, □ Need to shoot, ◩ Source);
  STORYBOARD is tracked 0.08em as the kit's labels are; a frame that fails to draw prints PICTURE MISSING and the
  rest of the PDF goes out, the export naming those frames; Stop ends a PDF export before the next frame; the
  watermark is drawn as the fixed 1.24 PNGs draw it, Inter Tight SemiBold in ink with a paper outline, both at its
  strength, last on the page, so it reads over a dark picture.
- Decided in review (Nov 4), to review: a corner watermark sits in the page's margin, top ones above the title and
  bottom ones between the frames and the footer, at 12pt at most (the room those bands have), so it never crosses a
  rule or the header; a run of characters the fonts lack (emoji; Chinese, Japanese or Korean) prints as one ?, and
  the export says so, rather than adding a fallback font (a new, large dependency); board notes stay out of the PDF,
  and the format's description says so (a note row between frames is a later option); the centred watermark keeps
  its 15 degrees (the PNGs' is flat), and its outline pass means a PDF reader finds its text twice on a page.
- Fixed in second review (Nov 4): line breaks and tabs typed into Action and Dialogue print as spaces, not as ? with
  the emoji warning; a stopped export says what it actually wrote, so a stopped PDF says nothing was written; the
  repo keeps LF line endings (.gitattributes).
- Fixed in third review (Nov 4): a frame is capped at 150pt tall so two rows always fit a page under a heading, and
  every aspect prints six frames a page (a 4:3, 1:1 or 4:5 board went out a row a page; a 9:16 frame is now 84pt
  wide); a file picked in the Save dialog is written beside it under a temporary name and renamed over it only once
  it is whole, so a write that fails partway (a full disk) leaves the old file as it was.

**As built in 1.24 (Nov 3): export** (src/features/export, src/core/storage/exportFiles.ts, src-tauri/src/export.rs):
- Export Project… in the project menu: a format from the registry (each one file plus one line in registry.ts), the
  whole project or one scene, then the Save dialog for a file or the folder dialog for a set. The Trash never goes
  out. Rust shows the dialogs and writes only where the person chose; a set of files goes into a new folder made
  inside the one picked (`Bey County frames`, then `Bey County frames 2`), so nothing there is ever overwritten.
  A file from the Save dialog is written once; in the new folder each file is made with create_new, never over a
  file or a link already there; a name is one plain part (no folders, no `:`), and must land right inside the folder.
- Shot list (CSV): one row per frame in board order, with scene, heading, length, location, specs, status, action,
  dialogue, departments and the custom fields (matched whatever case a frame spells them in); RFC 4180 quoting, CRLF
  and a byte-order mark, and a leading apostrophe on a cell that starts like a formula. A report: the lossless JSON
  and CSV export is Phase 2's.
- Frames (PNG): one per frame at 1920 on the long edge, the picture framed as on the board from the full-size stored
  picture, the sketch over it, on white, named `SC004_4A.png`. The scene's digits are padded so plain scene numbers
  line up (SC004 before SC012); a name sort isn't board order otherwise (12A files before 12, 4AA before 4B).
- Watermark Settings (project menu): text, position, strength and which exports carry it (PDF and PNG; the web review
  copy in Phase 9), one undoable edit to the project record; Save with nothing changed makes no edit. On a frame the
  watermark is sized from the short edge and shrinks until it fits between the margins.
- A running export can be stopped (Stop, or Escape); what it wrote stays in its new folder.
- Decided while building, to review: frames print on white in the kit's ink rather than on paper; an empty frame
  exports as a blank image so the sequence has no gaps; the browser build downloads each file.
- Decided in review (Nov 4), to review: names keep the slate's numbers and the sort claim was corrected, rather than
  adding a sequence number to every file; a name given twice in one export (two live scenes numbered 4, from an old
  file) gets ` (2)` before the extension, as the Finder and Explorer do; a stopped export keeps the frames it wrote.
- Decided in the second review (Nov 4), to review: the watermark is ink with a paper outline (a sixth of the type
  size) at the chosen strength, so it reads over a dark picture, rather than picking ink or paper from the picture
  under it; a frame whose stored picture is gone still exports, with PICTURE MISSING across it, and the export ends
  on a warning that names those frames by file name (the first ten, then a count); Strength runs 5 to 100% in steps
  of 5, the floor a stored watermark already has, on the kit's ruled range as the inspector's Zoom (not the tick
  Slider, whose 20 labels would crowd the dialog); the format is the kit's segmented control, the chosen format's
  description shown under it, and the On choices are the kit's switches.

**As built in 1.23 (Nov 3, review fixes Nov 4): named versions** (schema 4, src/core/storage/versions.ts,
src/app/openVersion.ts):
- In the History tile: Name this point names the newest step; versions are listed with their step, and each step
  shows the names on it. Open version copies the project beside it (`Bey County (Board sent to client).sbd`), gives
  the copy its own file id, restores it to the version's step, then opens it in place; the original isn't touched.
  Delete… asks first; the steps stay.
- The copy is made through the open project's own connection (no second connection holding the file, and the same
  on-disk check as a write), into a hidden draft that's restored on its own connection and renamed only once it's
  ready, so the original never runs the restore, even when the open is cancelled at "open on another computer"
  (the notice then says the copy was saved and not opened). A failure partway deletes the draft and says why; only
  drafts the app made can be renamed or deleted. The version's name is shortened where a file name or a Windows path
  would be too long: the copy's own, and its scheduled and pre-upgrade backups' (a copy whose upgrade backup can't be
  written won't open after the next schema change). Naming a version and Open version each run one at a time, so a double press makes one.
  While the copy is made the tile says `Copying “Board sent to client”…` and the Open version buttons take no clicks.
  The draft is hidden on Windows too (the hidden attribute, cleared just before the rename), as lock files are.
  Naming or deleting a version that's refused because a sync replaced the file reopens the newer version, as a
  refused edit does (src/features/history/versionWrites.ts). After Delete…, focus moves to the version that took its
  place, else the one before it, else the Named versions heading.
- Clean up old pictures keeps every picture a named version's step shows, until the version is deleted, so Open
  version never comes back with "Picture missing" because of it (Empty Trash still takes what it deletes, as before).
  Settings → Storage asks after every edit, so it stays quick however many versions there are: only media records
  are looked at, each version's point through the ops_by_record index, and which media records the log has is read
  once per open file and then only from the newest writes (Clean up itself reads the whole log again before deleting).
- Tests: Open version itself (src/core/storage/versions.test.ts): the copy is at the point and its restore undoes,
  it lasts a restart and the original keeps every frame and step; Cancel at the lock question leaves the original
  as it was; a restore that fails partway leaves no file; a file a sync replaced isn't copied; 80 Japanese characters
  fit, and so do the copy's backups' names and Windows paths; a v3 project upgrades to v4. Clean up leaves a
  version's picture and Open version shows it, and takes it once the version is deleted, and stays within a few ms
  with 60k ops and 30 versions (purge.test.ts). The drafts' guards in Rust (sbd.rs) and in the Node and memory drivers. End to
  end: Delete… asks and every step stays; two Enters in one moment name one version; two clicks on Open version make
  one copy; two versions sharing a name on one step both show; Delete… from the keyboard keeps focus in the tile.
  Naming and deleting on a file a sync replaced flag it for reopening (versionWrites.test.ts).
- Decided while building, to review: a version names the newest step only (name it right after the step you mean);
  renaming waits for a later milestone; Open backup's copy still keeps the original's file id, as before; two
  versions may share a name; a draft a crash cuts off stays beside the project, hidden, until the person deletes it;
  the name check leaves room for a two-digit schema, and a synced project's local backup folder isn't measured (its
  path isn't known when the copy is named).

**As built in 1.22 (Nov 3): the History tile** (src/features/history):
- History in the project menu opens it in the workspace on screen. Every step is listed newest first, undos, redos,
  restores and Empty Trash included, in the board's words ("Added frame 4C", "4A: lens 35mm → 50mm", "Moved 4B",
  "Undid: …"), with who and when. A drag that renumbers a scene is one step.
- Restore to here brings the project back to just after that step, as a new step that ⌘Z takes back (a restore
  never brings back what Empty Trash deleted). Steps load 100 at a time.
- Only frame 4A lists every change to the selected frame, newest first, field by field (change, before, after, who,
  when); with no frame selected, Only this note and Only scene SC 05 do the same for the selected note or the active
  scene. Before and after show in full, wrapped with their line breaks kept (a step's line cuts a long text to one
  short line), and Put back's label names the whole value. Undone and redone steps say so ("Undid: Added", "lens, undone"), Restore to here's changes are listed field
  by field ("lens, restored", "Restore to here: out of the Trash"), and renumbers show too. Put back sets an old value
  again as one step: the fields a person sets by hand (size, lens, T-stop, support, height, move, status, action,
  dialogue, departments, custom fields; a scene's name, INT/EXT, time of day and length; a note's text). A custom field goes back on its own, leaving the frame's others as they are;
  Put back isn't offered where the frame already has that value, and values that both read "—" (an empty text or no
  departments ticked, and one never set) count as the same, as do the same departments in another order. Values read
  as the board names them ("Grip & electric", "Need to shoot", "INS"), not as they're stored. A new selection shows
  only its own changes.
- Shot and scene numbers, lens and T-stop are set in JetBrains Mono in step lines and in the frame toggle.
- A step whose picture was cleaned up (1.21) says "(picture removed)", at once when History is open beside
  Settings → Storage. Values kept by id never show as ids: a scene's location reads by its name as it was then
  ("SC 05: location — → Dock"), and a frame's picture as "picture set", "picture replaced" or "picture removed".
- One restore or Put back at a time: a second click while one writes, or within half a second of its rows being read
  again, is dropped, so a double click never lands on the row that moved under the pointer. If those rows stop being
  read (Only frame turned off, the frame deselected or trashed, a read that failed), clicks count again from then, and
  in any case 5 seconds after the write. Restore to here on a
  point the project is already at says so. Past an Empty Trash, the notice adds that what it deleted can't come back,
  whether or not the restore changed anything.
- A frame's own history finds its strokes and picture in the log, so an undone sketch, or one Restore to here took
  away, still shows ("Sketched", "Undid: Sketched").
- Tests: a restore and its undo, a restore after a restart (and undone after another), a restore whose write dies
  halfway changing nothing, a restore after Empty Trash (src/core/ops/purge.test.ts), a frame's Trash state and the
  board's order brought back, Put back on custom fields and the action, no empty step, and paging.
- Decided while building, to review: numbers, pictures and framing aren't put back on their own (the board keeps
  them in step, so Restore to here is the way back for those); "who" is "You" until people have names (PE, Nov 5, gives them). A
  custom field taken off reads "no field", apart from an emptied one ("—"). Changes undone, redone or restored are
  marked by a word after the field rather than a column of their own. Clicks settle for 500 ms after a restore's rows
  are read again (about a double click). A point a restore can't change keeps its button and says so when pressed.
  The item filter takes the most particular selection (a frame, else a note, else the active scene), so a scene's
  own history shows once no frame or note is selected in it. Locations and characters get theirs when they have a
  selection of their own (Phase 3); until then their changes show as steps. A scene's location, number and number
  lock aren't put back on their own (Restore to here is the way back); its location reads by its name as it is now.

**As built in 1.21 (Nov 3): Empty Trash and Clean up old pictures** (src/core/ops/ops.ts, src/app/project/StorageTile.tsx):
- Empty Trash… in the Trash tile and in Settings → Storage; Clean up old pictures… in Settings → Storage (a tab beside
  Backups). Each asks first, in the system's warning dialog, saying it can't be undone, and reports what went. It
  runs only for the project the confirm was about. How each changes the file is in docs/SBD_FORMAT.md (Trash).
- Deleted rows are overwritten with zeros (SQLite's `secure_delete`, on every connection from 1.21 on), so what's
  deleted is gone from the file itself and from backups made after. The file doesn't shrink; the space is used for new
  pictures. Space freed before 1.21 wasn't zeroed: in a project edited with an earlier build, an older version of a
  record's text (a note or name changed since) can still sit in the file's free space after Empty Trash. Pictures
  aren't affected (their bytes were never freed before 1.21). Clearing that would take a one-time VACUUM, a rewrite
  of the whole file. Kevin, Nov 4: no automatic one; Compact project (1.27) is in Settings → Storage.
- A History restore after Empty Trash goes back as far as it can: a record that would go back under a parent that's
  gone stays as it is now, and so does whatever it sits under. A frame kept as it is now keeps its scene as it is now,
  and a scene kept as it is now keeps every frame in it or going back into it (1.26, so a scene never comes back
  locked around numbers that were never on its slates); a scene or frame that would go back onto a number another one
  holds stays as it is now too, so no two scenes share a number and no number lands twice. Letters can be left with a
  gap (4A, 4C, when 4B was deleted for good); the scene's next edit closes it up, as unlocked scenes do.
- Each deletes only what its confirm counted: anything trashed, or left to History, while the confirm is up stays.
  Empty Trash deletes what people put in the Trash (scenes, frames, notes, pictures) and what's under it; a stroke
  erased from a frame still on the board stays, with its History.
- Kevin, Nov 4: a locked scene keeps its letters after Empty Trash too. Built in 1.26 (slate numbers, schema 5); the
  confirm's warning stays only where the migration couldn't recover them.
- Tests for both: undo can't reach past them, they last a restart, a History restore after them (and after a
  restart), a write that dies just before it commits changes nothing, and the picture's bytes are gone from the file.
- Decided while building, to review: "pictures only History uses" means pictures no record shows, live or in the
  Trash, and no step on the undo stack had (so one ⌘Z, such as undoing a History restore, never brings back a frame
  whose picture is gone; only redo can). A picture replaced in a frame goes to the Trash (1.11), so its space comes back with Empty Trash rather than
  Clean up. Clean up leaves the log as it is, so a redo can bring back a frame whose picture now reads "Picture
  missing". The file isn't compacted; Compact project (1.27) does that, after a backup.

**As built in 1.20 (Nov 3): the Trash tile** (src/features/trash):
- Opened from the Layout menu in any workspace (it's in no default layout). It lists deleted frames, notes, scenes and
  pictures, newest first, with the scene each belongs to and when it was deleted; filters by type and scene.
- Restore is one click and one undoable op group, and brings back what the item needs (docs/SBD_FORMAT.md, Trash);
  focus stays in the list, or goes to the message once the list is empty.
- Slate numbers stay unique: in a locked scene a restored frame keeps its letter unless a live frame anywhere has
  taken it since, when it takes the next free one (from 1.26, also unless another shot was slated with it); a restored scene whose number a live scene has taken gets a new one, and
  its frames are lettered afresh under it, even in a locked scene. A trashed scene's number can't be given to another
  scene (as + New scene already counted it). The notice names what came back as it's numbered now.
- Tests: undo and redo of a restore, restore after closing and reopening the project, a write that fails halfway
  leaving the item in the Trash with nothing half restored, locked scenes, a taken scene number.
- Decided while building, to review: restoring a frame's old picture makes it the frame's picture again (the newer one
  goes to the Trash) and resets the crop, as choosing a picture does; the project's logo or key image comes back on
  its own, without becoming the theme's image again; in a locked scene renumbered while a frame was in the Trash, the
  frame comes back on its old letter, as its locked neighbours keep theirs, unless a live frame anywhere has it; a restored scene that needs a new number
  stays where it was on the board, so in an old file it can read out of order (4, 4B, 4A); a picture whose frame went
  to the Trash with its scene brings the scene back with that one frame.

**As built in 1.19 (Nov 3): custom fields on shots** (src/core/model/customFields.ts):
- The inspector has a Custom fields section: each of the frame's fields saves like the others (on leaving it or
  Enter), with Remove beside it; New field takes a name (offering the names the project's frames use, and taking the
  project's spelling of one it has) and focuses the new field for its value.
- The shot list shows a column per field name the project's frames use.
- A shot keeps its fields in one prop, `custom`, of text by name (docs/SBD_FORMAT.md); the list of names is worked out
  from the shots, never stored, so a field lasts as long as one frame has it.
- Decided while building, to review: values are text only (no number or date types yet), names are up to 40
  characters, and fields are on shots only; locations and people get theirs with their tools in Phase 3.

**As built in 1.18 (Nov 3): script import from PDF** (src/core/script/pdfLayout.ts, src/features/script/readPdf.ts):
- pdf.js (pdfjs-dist 5.7.284, Apache-2.0) gives each page's text with its position; nothing is drawn, no fonts load,
  and it loads only when a PDF is imported. 5.7.284 is the last release built for Safari 16.4 (macOS 13's webview);
  6.x needs Safari 18. Its optional `@napi-rs/canvas` (MIT) is for rendering in Node and isn't used. The CSP names
  `worker-src 'self'` for pdf.js's worker.
- A screenplay PDF is read by its layout, Courier 12 on fixed margins: a line at the action margin that starts like a
  heading is a heading; a capitals line about two inches in with dialogue under it is a character cue. Scene numbers
  are the numbers printed outside the margins; page numbers (`2.`), (MORE) and CONTINUED are left out. Length comes
  from the lines a scene fills, blank ones included.
- A PDF with no text (a scan) imports nothing and says to export the script as a PDF from the writing app; a
  password-protected or broken one says so, naming the file.
- After review: the action margin is measured across the whole script (a page of dialogue alone has few lines at it);
  any short token with a digit outside the margins is the scene number (`12-14`, `7a`, `A7`, checked as 1.17 does);
  revision asterisks are dropped; a row split by a gap of an inch or more is two columns, so both speakers of dual
  dialogue count; rotated or offset pages are read as shown; and the title comes only from a title page.
- pdf.js's worker is made by the app from its own file. Left to pdf.js, the desktop app's tauri:// origin reads as
  foreign and pdf.js would parse on the page itself, freezing the window on a large file. A read that takes over 60 s
  is stopped.
- Decided while building, to review: the title is the first line on the first page before any scene, which is the
  title page's title in a standard layout.

### Web companion

| Feature | What people can do |
|---|---|
| Call sheet | See the latest call sheet for their days, with their call time and scenes |
| Storyboard viewer | Browse compressed frames and shot info, in the project's theme; no video, no editing tools |
| Bird's-eye viewer | See the latest plan for each scene, read-only |
| View-only link | Optional, off by default: anyone with the link sees the storyboard and bird's-eye plans, nothing else, until the review copy expires |
| Availability | The producer proposes dates for a scene; each person marks the dates they can make. Whole days only, no hours |
| Comments and suggestions | Leave feedback on any frame, plan or call sheet. Team members with reviewer access suggest deleting a shot or scene, which shows grayed out. Suggestions download as a change file that the desktop app imports for approval |
| Company workspace | A brand groups its people: CEO and marketing approve, creators plan and shoot |
| Calendar | Month and week views of their shoot days and availability, plus the schedule as a list |
| Notifications | Updates on their days, scenes and call sheets, read and unread |
| Trash | Team members with Trash access see everything in it; a restore request is a suggestion for the desktop |

Calendar, Notifications and Trash are main navigation items. Cast and crew see only their own days and updates.

The web companion is the only part that needs a server, so it has a running cost and holds private data such as phone
numbers and addresses. Each person gets a private invite link (the optional view-only link never shows private data), contact details show only to people on that call sheet,
and review copies expire after the shoot. Supabase's free tier covers testing; client work needs paid plans (about $45
a month, see Hosting the review copy). Open-source users can host their own.

### Who uses what

| Role | Where they work | What they do |
|---|---|---|
| Director | Desktop | Everything; approves suggestions |
| DP | Desktop | Storyboard, camera layer of the bird's-eye view, 3D set, camera gear |
| Gaffer, key grip | Desktop or web | Lighting and grip layers, their gear lists; suggest changes |
| Producer, AD | Desktop | Script import, schedule, call sheets, availability, cast and crew |
| Creative director, production designer, HMU, wardrobe | Desktop or web | Their department moodboards; suggest changes |
| Sound | Web | Call sheet, sound notes and gear; suggest changes |
| Editor | Web or desktop | Storyboard and shot list with scene and shot numbers that match the slate; boards as PDF; marker export for Resolve and Premiere later |
| Cast | Web | Their call sheet, their scenes, availability |
| Client, marketing, CEO | Web | Storyboard, decks, approvals, comments |
| Content creators | Desktop | Their own projects inside a company workspace |

**Cut line:** desktop tools ship before the web companion. A tool has to work on a real shoot before anyone else sees it.

### From Kevin's Notion

Kevin's Notion project templates already link shots to locations and track shoots through a status pipeline; Storiiboard
adopts those habits so the app matches how he already works.

| Notion source | What it shows | What Storiiboard adopts |
|---|---|---|
| Projects database | Client, type (photo, video, audio), budget, shoot date, due date, payment due, status from Discovery / Contract through Production, Editing, Revising, Pending Invoice, Complete | Same fields on the project record and a status pill on each project card |
| Brand Collab shot list | Shot name plus location, a deliverables checklist, example content, point of contact | Confirms the core link: every shot carries a location. Add a deliverables checklist and client contact to each project |
| YouTube video template | Pre-production, post and upload checklists; b-roll color-coded as already have, need to film, or need to source | Shot status on every frame: Have, Need to shoot, Source. The schedule only pulls "Need to shoot" frames into shoot days |
| 5 Free Tools That Fix Claude's Front-End | Playwright for self-testing; design.md files as a design system to hand Claude; a taste skill against generic AI looks | Phase 0 writes docs/design.md from the /prototype look, so Claude Code builds to it. (Superseded Nov 2: design/DESIGN.md from Kevin's design kit.) Playwright is already in the plan |

Not in Notion: anything on Storiiboard, Bey County, call sheets or locations, so those still come from Kevin directly.

### What we take from Notion

Notion's strength is one set of records shown many ways. Storiiboard applies that to film, with the structure already
built so nobody starts from a blank page. Edit a shot once and the storyboard, shot list, schedule, call sheet and deck
all change with it.

| Notion pattern | Storiiboard version | Phase |
|---|---|---|
| Every item is a block: id, type, properties, children, parent | Every item is a record with the same shape. Changing its type keeps its data, so a reference image becomes a frame without losing anything | 0 |
| Edits saved as small operations | Every edit is an operation. Operations drive undo, autosave and the edit history | 0 |
| One database, many views | Shots are one table; the storyboard grid, shot list, schedule and call sheet are views of it | 1 to 3 |
| Custom properties | Users add their own fields to shots and locations, such as drone, VFX or budget | 1 |
| Slash menu, keyboard-first | "/" inserts a frame, scene, note or location; arrow keys and shortcuts move between frames | 1 |
| Relations | Each shot links to its scene, location and shoot day. Edit a location once and every shot and call sheet updates | 2 |
| Rollups | Each shoot day totals its shots, setups and estimated hours; each location lists its shots | 2 |
| Import and export | Import a shot list CSV; export JSON, CSV and PDF | 2 to 4 |
| Content shown in several places | Location contacts, parking and safety notes appear on every call sheet that uses that location | 3 |
| Templates and a template gallery | Project templates for commercials, music videos, shorts and docs, as plain files people share on GitHub or Patreon | 4 to 5 |

**Where Storiiboard goes further**

- **Offline:** Notion's offline mode works per device, downloads only the first 50 rows of a database, and embeds don't
  load offline. Storiiboard is offline by design, and embedded videos keep a cached thumbnail so the board still reads on set.
- **No blank page:** Notion makes you build your own system. Storiiboard ships the film structure ready to use, and
  customization sits on top.
- **Ownership:** Notion keeps your data on its servers. Storiiboard projects are plain files on your drive.
- **Skipped for now:** wikis, team spaces, real-time collaboration and AI agents.

## Architecture and stack

One React codebase runs the desktop app (inside Tauri) and the web companion. The desktop app saves to a single .sbd file
and works offline; only the web companion needs a server.

| Layer | Choice | Why |
|---|---|---|
| App UI | Vite, React, TypeScript, Tailwind | Same UI code powers the web companion |
| Desktop shell | Tauri 2 | Installers are a fraction of Electron's size and lighter on memory; uses each OS's own browser engine, so test on Mac and Windows |
| Desktop, fallback | Electron | Same Chromium everywhere; switch if rendering differs between Mac and Windows |
| Project file | .sbd, a SQLite database, through Rust commands (rusqlite) in the Tauri shell. The PDF named Tauri's SQL plugin; changed Nov 1, 2026 so every op commits in one transaction | One crash-safe file that saves every edit instantly |
| Canvas | react-konva for sketching, moodboards, the bird's-eye view and deck pages | Free (MIT); handles images, transforms and PNG export |
| State | Zustand; every edit is an operation | Undo, history, web suggestions and AI edits all share one path |
| Video | Bundled ffmpeg (LGPL build) makes playback copies with the computer's hardware encoder, grabs stills and trims clips | Mac and Windows play different formats natively; playback copies make every file play smoothly |
| Weather | Open-Meteo: hourly forecast, sunrise and sunset; no API key | Free for non-commercial apps; donations are allowed, paid features are not |
| Golden hour | SunCalc library, computed offline | Works on set with no signal |
| Maps and addresses | OpenStreetMap tiles, plus Nominatim to look up an address the user types | Free; one search per user action, results cached, no autocomplete, app named in every request |
| Maps, optional | User pastes their own Google Maps key in Settings | Google needs a billing account; each user stays inside its monthly free usage |
| Cloud links | Dropbox public folder links download as one zip; Google Drive folders shared with "anyone with the link" are listed and downloaded through the Drive API | No sign-in for public links; private folders need sign-in in a later phase |
| Web companion | One static app on Vercel; Supabase (Postgres, magic-link sign-in, storage for review copies, row-level security) | The only server; publishing uploads a review copy and redeploys nothing |
| Project themes | Colours worked out on the device from the project's logo: OKLab clustering in a Web Worker, 12 curated background families | Works offline, with no service and no new dependency |
| AI | Storiiboard's own MCP server, plus optional in-app chat with the user's own key for Anthropic, OpenAI, Gemini or OpenRouter | Any MCP-capable AI gets full project context; Storiiboard pays nothing for AI |
| Export | Konva renders pages to PNG, pdf-lib builds the PDF | Pixel-matched call sheets, boards and decks |
| Quality | Vitest, Playwright, GitHub Actions building Mac and Windows installers | Claude Code can check its own work on every PR |

### Dependencies and licences

Every dependency is asked for first (CLAUDE.md). These are the ones approved by name, beyond the stack above and what
Tauri, React and the build tools bring with them.

| Dependency | Licence | What for | Approved |
|---|---|---|---|
| FFmpeg 8.1.3 (ffmpeg and ffprobe) | LGPL 2.1 or later; built without `--enable-gpl`, `nonfree` or `version3`, and run as separate programs, never linked | Reading videos, stills, playback copies, LUTs | Phase 2 plan, Nov 5 |
| zimg 3.0.6, built into ffmpeg | WTFPL 2: **an exception to the licence list**, approved by Kevin | `zscale`: HDR (PQ, HLG) to linear light and back to BT.709, so HDR stills and copies come out in normal range | Kevin, Nov 5 (D1) |
| dav1d 1.5.4, built into ffmpeg | BSD-2-Clause | Decoding AV1 | Kevin, Nov 5 (D1) |
| windows-sys 0.61.2 (Windows only) | MIT or Apache 2.0 | Free space on a drive; a Job Object, so ffmpeg stops when the app does, crash or not | Kevin, Nov 5 (D2) |
| libc (macOS only) | MIT or Apache 2.0 | The attribute File Provider services put on synced folders; free space (D2) | Nov 2 |
| pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1 | MIT | The PDF storyboard and, later, call sheets | Nov 4 |
| font-kit 0.14.3 (Rust) | MIT or Apache 2.0 | This computer's fonts for boards, and their embedding bits for PDF export (Phase 5, decision 7) | Kevin, Nov 10 |

The installers ship each built-in licence beside the binaries (`ffmpeg-LICENSE.txt` and `.md`, `zimg-LICENSE.txt`,
`dav1d-LICENSE.txt`) and `ffmpeg-SOURCE.txt`, which records every source, its checksum and how it was built, with
x86inc.asm's ISC notice on x86 and, on Windows, the MSYS2 runtime packages linked in and their notices; the source
tarballs ride in every CI artifact (`scripts/ffmpeg/README.md`).

## The .sbd project file

Every Storiiboard project is one .sbd file. Double-clicking it opens the app, like a .prproj or .drp.

- Inside, a .sbd is a SQLite database, the same format behind Lightroom catalogs and most phone apps. It saves each edit
  the moment it happens and survives crashes and power cuts.
- It holds all project data, the edit history, images and thumbnails. Video stays outside as linked files or cloud links
  with a cached thumbnail, so the .sbd stays small enough to email or drop in a shared folder.
- **Collect Project** packs the .sbd and every linked file into one .sbdpack zip for handoff.
- The format stays open: the schema is documented in the repo (docs/SBD_FORMAT.md), and every project exports to JSON and CSV.
- Each file records its schema version; older projects are backed up, then upgraded when opened.
- Every 5 minutes, if anything changed, a full copy goes to a Backups folder next to the .sbd. It's made with SQLite's
  backup API, so it's consistent while the project is open. The last 12 copies and one a day for 14 days are kept, and
  both numbers are in Settings. Saving each edit the moment it happens stays as it is.
- Deleting moves an item to the Trash instead of erasing it: it keeps its data, can be restored, and stays out of every
  view until the Trash is emptied.
- History (every edit) stays in the file for the life of the project, and named versions are points in it. Backups are
  the copies outside it.
- The project's theme and watermark are stored in the file, so exports and the web review copy look the same.

This replaces the earlier folder-of-JSON plan. The trade-off is that a project is no longer easy to compare line by line
in git; the JSON export covers that.

## AI assistant (MCP)

Storiiboard runs its own MCP server, so Claude or any MCP-capable AI can read the whole project and propose changes.
Nothing changes until a person approves it, and the app works fully without AI.

- **Read:** scenes, shots, schedule, call sheets, cast and crew, gear, locations, bird's-eye plans, suggestions.
- **Propose:** add or edit shots, reorder the schedule, draft a call sheet, fill a gear list. Every change lands in the
  approval queue.
- **Check:** scan the project for the mistakes that cause miscommunication on set:
  - a cast member is called on a day they marked unavailable
  - a shot needs gear that is not on that day's list
  - a golden-hour shot is scheduled at midday, or an exterior lands on a day with rain forecast
  - a location has no address, contact or parking note
  - a department is missing from a call sheet that needs it, such as sound on dialogue scenes
  - hair and makeup time is too short before a cast call
  - the storyboard lens differs from the camera lens in the bird's-eye plan
- **Script to scenes:** read a script and propose the full scene list, locations and cast roles, then a breakdown of
  props, wardrobe, vehicles, stunts and VFX per scene.
- **Blender:** working alongside a Blender MCP server, turn a bird's-eye plan into a 3D scene and adjust it on request
  ("move the key light to camera left").

For the content series, the line stays honest: AI works for the crew and catches mistakes; it never makes the art.

## Roadmap

About 36 weeks of part-time building takes the desktop app to a public release in mid-May 2027, with the web companion
live by July. Each phase is usable on its own, so the build can pause at any gate without losing work.

Dates are estimates from a Nov 2, 2026 start. **A phase moves on only when its gate passes on Kevin's own material, not
demo data.**

| Phase | Delivers | Gate |
|---|---|---|
| **0 · Foundation and .sbd** (done) | Desktop shell with sidebar navigation, .sbd file with autosave, history and backups every 5 minutes, Projects screen with project state, installers from CI, prototype archived | A project survives a force-quit, and double-clicking a .sbd opens it |
| 1 · Storyboard | Project themes and onboarding, script import into scene shells, frames, shot specs, sketching, "/" menu, custom fields, Trash tile, History and named versions, export (PDF, PNG, shot list CSV) with watermark | A real scene is boarded in one sitting |
| 2 · Video and images | Playback copies (a cache per computer, about 50 GB, movable), frame stepping, in and out, crop, LUTs for log footage, still and clip capture, the lossless JSON export | A still from a reference clip lands in a frame in a few clicks |
| 3 · Production data | Project details and company profiles; locations, cast and crew, departments and department workspaces; shoot days, Calendar tile; gear per day; client contact and deliverables; notification history; Team section; Assets and attachments (from Phase 2) | A real shoot's people, places and gear are entered |
| 4 · Call sheets | Call sheet per day with weather, sun times, map and hospital; PDF | Used on a real shoot day |
| 5 · Canvas flow | One infinite canvas for moodboards and decks (Kevin, Nov 5): see Phase 5 notes | A deck built in under an hour |
| 6 · Bird's-eye view | Setup section: top-down plans with walls, cast, cameras with true field of view, lights, department layers, on the canvas foundation | A gaffer plans a real setup with it |
| 7 · AI assistant | MCP server, mistake checks, review screen for AI suggestions and imported change files | The checks catch a real scheduling or gear mistake |
| 8 · Cloud links and release | Dropbox and Google Drive links, Collect Project, signed installers, public repo, Patreon | A stranger installs it and opens a shared project |
| 9 · Web companion | Review copy in the project's theme: call sheets, compressed storyboard, bird's-eye viewer; availability, comments, suggested deletions downloaded as change files, company workspaces, Calendar, Notifications and Trash | Cast and crew get their call sheet from the site and send a suggestion |
| 10 · 3D set and Blender (July to September 2027) | 3D set preview, glTF export, Open in Blender, the simple Blender layout | A DP checks a real setup through the 3D camera before the shoot |

### Phase 4 notes

- When a scene goes on an issued call sheet, its shot numbers lock automatically (Kevin, Nov 3): slates and the script
  supervisor work from them from then on. The lock is the same `numbers_locked` prop the Scenes tile sets (1.6), set
  in the op group that issues the call sheet, so undoing the issue unlocks it again. Unlocking by hand stays possible.

### Phase 5 notes (canvas flow; Kevin, Nov 5)

Moodboards and decks merge into one canvas flow, like Figma and FigJam, and the bird's-eye view moves to Phase 6 so it
can reuse the canvas foundation. Not built now. The canvas should have:
- an infinite canvas with pan, zoom and a minimap; text boxes, sticky notes and shapes in any colour; pictures and video
  links; scene palettes; brand-kit cards (colours, fonts, logo, from Phase 3's company profiles);
- connectors that snap to items and move with them (straight, bent or curved, with arrowheads and labels), and
  quick-create of a connected item;
- sections that group items and move with their contents;
- Tidy up (rows, columns, grid), align and distribute, and snap guides;
- shots and scenes from the storyboard as live linked cards that jump back to the board when clicked.

### Phase 6 notes (bird's-eye view)

Field of view is `2 * atan(sensor_width / (2 * focal_length))` (CLAUDE.md), so both numbers have to be real (Kevin,
Nov 3):

- **Camera body per project, with its sensor width.** For example, Sony FX3, full frame, 35.6mm. The bird's-eye
  cameras and the 3D preview read it, and a project can list more than one body (A and B cameras).
- **Lenses can be zooms and anamorphic.** A zoom records its range and the focal length used for the shot. An
  anamorphic lens records its squeeze factor, such as 1.33x or 2x, which widens the horizontal field of view by that
  factor at the same focal length. The shot's `lens_mm` stays the focal length used; the range and squeeze are new
  props, proposed for approval in Phase 6's plan.

### Phase 7 notes (shot prompts and coverage; Kevin, Nov 9)

Not built now. Storiiboard never generates images itself.
- From an imported script, propose scene and shot templates, suggested coverage per scene (master, mediums, singles,
  inserts), as suggestions Kevin approves in the review screen.
- For each shot, write an image-generation prompt from its data (size, lens, movement, INT/EXT, time of day,
  location, characters, action, the scene's palette, aspect ratio) to copy into the AI image tool of the person's
  choice.
- A frame can be marked "AI-generated image", shown as a small badge on the board and in exports.
- A "Copy image prompt" button builds the same prompt from shot data without AI, so it works without the MCP.

### Phase 8 release checklist

- [ ] Run the Phase 0 gate's force-quit, undo-after-restart and backup steps on Windows (Phase 0 ran them on the Mac
  only).
- [ ] Choose the license, Patreon tiers and signing (also in Next steps).
- [ ] An option to save a copy of a project without contact details (Kevin, Nov 5): call sheets hold phone numbers
  and addresses, so a copy to share widely can leave them out.
- [ ] First-run profile setup tells new users their name (or initials) is saved with each edit they make (Kevin, Nov 5;
  no one-time notice for existing profiles, as Kevin is the only user so far).
- [ ] Stop every card redrawing on each change, so a feature film's board (about 1000 frames in 120 scenes) stays as
  quick as a 300-frame one (Kevin, Nov 5; the numbers are in Q2 as built).
- [ ] Third-party notices with the installers (4.3): SunCalc (BSD-2-Clause), tzf-rs and its geometry crates (MIT),
  and tzf-dist's time-zone shapes (ODbL-1.0, © OpenStreetMap contributors, from timezone-boundary-builder).
- [ ] A Windows 10 pass (Kevin, Nov 10): Storiiboard supports Windows 10 22H2 and Windows 11, and CI only runs
  Windows Server, so each release's Windows installer is run by hand on a Windows 10 22H2 PC: an install with
  WebView2 already there, one without it and online, and one without it and offline (see "Windows 10" below), then
  the release's checklist.
- [ ] Attach the FFmpeg source tarball (`ffmpeg-<version>.tar.xz`, in each ffmpeg CI artifact) to every release beside
  the installers, as the LGPL asks of whoever hands out the binaries (2.1).

### Windows 10

Storiiboard supports Windows 10 22H2 and Windows 11 (Kevin, Nov 10), 64-bit (x64), and macOS 13 Ventura or later on
Apple silicon (the Mac build is `aarch64-apple-darwin` only). Nothing in the code rules Windows 10 out: WebView2 keeps
updating there until at least October 2028, Rust's `x86_64-pc-windows-msvc` target runs on 10, and the Windows calls
the app makes (free space, Job Objects, regional formats, the file association, the single-instance hand-off, the
native dialogs) all exist on 10. CI runs only Windows Server, so these are what could differ, and what the by-hand
pass checks:
- **No WebView2.** It usually comes with Windows updates or Microsoft 365, but not on every clean or long-offline
  install. Tauri's installer is in its default mode (`downloadBootstrapper`): it downloads WebView2 when it's missing,
  so it needs the internet then; offline, the install can't finish. The other modes: `embedBootstrapper` (still
  online), `offlineInstaller` (works offline, adds well over 100 MB to the installer). Kevin's call for Phase 8 (in
  docs/HANDOFF.md): the recommendation is a second, offline Windows installer beside the normal one.
- **N editions** (Windows 10 N and 11 N) lack Media Foundation until Microsoft's Media Feature Pack is installed:
  without it, playback copies can't be made (the LGPL ffmpeg has no other H.264 encoder) and WebView2 can't play
  H.264. Pictures, boards and call sheets still work. Today the app says only "That video couldn't be made into a
  playback copy"; naming the Media Feature Pack there is a small fix, in HANDOFF for Kevin.
- **Windows 10 on Arm** can't run x64 apps (only Windows 11 on Arm emulates them), so it isn't supported; Windows 11
  on Arm runs the x64 build. S mode installs only Store apps.
- **Older GPUs.** Windows 10 PCs are often older, and WebView2 turns off GPU drawing on blocked drivers, which slows
  every canvas (the storyboard, maps, Phase 5's boards). The pass includes the Q2 board and, once built, Phase 5's
  500-item board.
- **Certificates.** Requests verify through Windows' own certificate store (rustls-platform-verifier), which fetches
  missing roots from Windows Update; a PC with root updates turned off by policy may refuse api.met.no or the tile
  server. Worth one look on a managed PC.
- **Fonts.** The app's fonts are bundled, so nothing depends on Windows 11's (Segoe UI Variable). Phase 5's font list
  reads Windows' own collection, so per-user fonts (Adobe Fonts) are checked on 10 as on 11.
- **The look of the window**: title bar, dark mode and scaling come from Windows; 10 has square corners and no Mica,
  which the app doesn't use.

**After Phase 10:** device-wide search for missing files, sign-in for private cloud folders, real-time collaboration,
Resolve and Premiere marker export.

### Phase 0 · Foundation and .sbd (done, Nov 2)

Kickoff steps (from the hand-off):

1. Move the existing prototype into /prototype and remove its client-side password gate.
2. Scaffold Tauri 2 + Vite + React + TypeScript + Tailwind at the root, using the repo layout in CLAUDE.md.
3. Build src/core/storage and src/core/ops: create, open and autosave a .sbd file (SQLite), with an operation log, undo
   and redo, and a meta table holding schema_version.
4. Register .sbd with Mac and Windows so double-clicking opens the app.
5. Write docs/SBD_FORMAT.md for the first schema.
6. Add Vitest, Playwright, ESLint and a GitHub Actions workflow that builds Mac and Windows installers.
7. Ship a Projects screen (New, Open, Recent) that matches the prototype's look. (Since Nov 2: match design/DESIGN.md.)

**Exit criteria**

- [x] CI green on both platforms (Mac and Windows installers build on every PR).
- [x] A project survives force-quitting mid-edit.
- [x] Double-clicking a .sbd opens it.
- [x] Undo works across an app restart.
- [x] Edits produce a backup within 5 minutes, and Open backup opens it as a separate project.
- [x] Gate passes on Kevin's own material, not demo data.

Passed Nov 2 on the CI installers: every step on a Mac; on Windows, creating a project and double-clicking a .sbd
(with the app closed and while running). The other steps (force-quit, undo after a restart, backups) ran on the Mac
only. CI builds the Windows installers but runs the tests on Linux, so those steps are untested on Windows; they're
worth a run there before the first public release.

## Nov 2 features, round two

Planned, not built. Each feature starts only when its phase's plan is approved.

| Feature | Phase | Milestone |
|---|---|---|
| C · Navigation: left sidebar and project menu | 0 | D3, after D2 |
| Archive Project (a project's state) | 0 | 0.7, with the Projects screen |
| A · Per-project theming: tokens, generator, switching | 1 | First in Phase 1 |
| B · Project onboarding and Settings → Theme | 1 | Second in Phase 1 |
| F · Synced folders: detect and note, lock file, check before every write; local backups for synced projects | 1 | Phase 1 planning places it |
| History panel and named versions | 1 | After the storyboard core |
| D · Export: PDF storyboard, PNG sequence, shot list CSV, watermark | 1 | Last in Phase 1 |
| Assets, Team, Setup and Moodboard sections fill in | 2, 3, 5, 6 | With their tools |
| E · Review screen and change-file import (desktop) | 7 | With the approval queue |
| E · Themed review copy, suggested deletions, change-file download (web) | 9 | With the web companion |

Phase 1 planning numbers its milestones; the order above is the recommendation.

- Theming goes first in Phase 1 because it renames the colour tokens that every later screen is built from.
- It stays out of Phase 0, whose gate is file safety, and it needs the media tables that arrive with the first stored
  image.
- The sidebar comes right after D2 because it replaces the top bar's workspace tabs that D2 docks into.

### A · Per-project theming

**Tokens.** A theme sets ten CSS variables: Kevin's eight, plus two the kit already needs.

| Token | Kit token today | Used for |
|---|---|---|
| `--bg` | `--sb-paper` | App background, under the grain |
| `--surface` | `--sb-panel` | Tile fill |
| `--surface-raised` | `--sb-oatmeal` | Wells, the open tab, selected rows |
| `--border` | `--sb-rule` | Tile outlines |
| `--border-top` | `--sb-rule-top` | Top bar outline (paper in dark) |
| `--text` | `--sb-ink` | Text, rules, and the ink fill that marks a selection |
| `--text-muted` | `--sb-muted` | Secondary text |
| `--text-inverse` | `--sb-ink-inverse` | Text on the ink selection fill |
| `--accent` | `--sb-accent` | Orange's five uses in DESIGN.md |
| `--accent-contrast` | `--sb-on-accent` | Text on the accent |

- design/tokens stays an exact copy of the kit and becomes the default theme, except that the default accent is
  #DF5E27 (decided Nov 2). The Tailwind classes move to the new names in the same PR, as a mechanical rename.
- The app keeps rendering #E0612B until that milestone, which changes the accent, adds the brand token and
  regenerates the visual baselines in one go.
- Some colours are not themed, so they mean the same thing in every project:
  - Signal Orange on the logo.
  - Warning (Truffle) and golden hour (Burning Flame).
  - The department colours, and the fixed paper and ink text on tags and chips.
- Only colour changes. Type, 1.5px rules, grain, tiles, layout and the shot-status shapes stay as DESIGN.md has them.
  The grain is grey with transparency, so it works on any tint.

**Hardcoded colours to refactor.** No component has a hex value today. The prototype has many, but nothing imports it.

| Where | What | Fix |
|---|---|---|
| src/ui/logo/SMark.tsx, Wordmark.tsx | The orange dots use the accent class, so a project theme would recolour them, which DESIGN.md forbids | A fixed brand token, Signal Orange #E0612B (decided Nov 2) |
| src/ui/icons/plan (68 SVGs) | Literal ink strokes; oatmeal and white fills; 6 orange and 3 Truffle strokes. The ink strokes already disappear on a dark plan | Phase 6 recolours them as they render: ink, oatmeal, white and orange become tokens, and department fills stay fixed |
| src/ui/theme.css | `--color-paper-fixed: #eee9df` | Move it into the fixed token set |
| src-tauri/tauri.conf.json | Window `backgroundColor` #EEE9DF | Set it from the project theme at runtime, so resizing a dark project never shows paper at the edges |
| public/theme-boot.js | Sets only `data-theme` before first paint | Also apply the last project's tokens, cached in settings |

**Generator** (src/ui/theme, shared by desktop and web; no network and no new dependency)

1. Decode the image in a Web Worker and shrink it to about 96px. Skip transparent pixels and a logo's flat
   background.
2. Cluster the pixels in OKLab (k-means with a fixed seed), so the same image always gives the same theme.
3. Offer 3–4 accent candidates: the clusters with enough colour to read as colour, ranked by saturation and share,
   and kept visibly apart. The default is the most saturated. A black-and-white logo offers none and keeps the
   default orange.
4. Snap the accent's hue to the nearest of 12 curated families: Paper (the kit, the default), Sand, Clay, Rose, Plum,
   Violet, Navy, Slate, Teal, Sage, Olive and Ochre. Each family has hand-tuned surfaces for light (soft pastels) and
   dark (deep tinted darks), checked once and stored as a table, so no generated background can be unreadable.
5. Adjust the accent as little as AA needs: keep its hue, then move its lightness (and its chroma, if lightness isn't
   enough) until it reaches 3:1 against `--bg`, `--surface` and `--surface-raised`, with 4.5:1 for the text on it.
   That text is ink whenever ink passes, as in the kit.
6. Output both modes' tokens, plus the extracted and adjusted accents for the Settings preview.

**Switching.** The tokens are registered with CSS `@property`, so the whole UI eases from one theme to the next in
200ms, with no reload and no per-element transitions. Reduced motion switches instantly, and so does any webview
without `@property`. Canvases (react-konva) re-read the tokens when the switch ends.

**Light and dark.** Every theme has both. The project stores its preferred mode, chosen at onboarding. Each person's
Appearance setting gains "Follow project", the new default, next to System, Light and Dark.

**Tests**

- Unit: every family, mode and accent hue (every 10°, at three chroma levels) passes AA on every token pair, and
  fixture logos give the same theme on every run.
- axe: the existing shell and catalogue checks run under the themes from 12 fixture logos, light and dark, in WebKit
  and Chromium. The fixtures cover one per family and the hard cases: grayscale, transparent, photo, near-white and
  neon.
- e2e: switching projects swaps the tokens in about 200ms without a reload, and reduced motion switches instantly.

**As built in 1.14 (Nov 3)** (src/ui/theme/generator):
- Images are read at 96px in a Web Worker and clustered with seeded k-means (8 clusters) in OKLab. A colour that
  fills most of the edge (see-through places included) is the ground. A quiet one (chroma under 0.08, or very light:
  white, grey, cream) is left out; a clearly coloured one stays, so a solid red image or a white mark on a red square
  offers red. A candidate that's a straight sRGB mix of a kept accent and the ground is a soft rim and isn't offered;
  so a lighter or darker tint of the same hue next to the mark is left out too (decided while building, to review). The same image gives the same accents
  on one engine; WebKit and WebView2 shrink images slightly differently, which the stored tokens make harmless.
- The accent's lightness may move across the whole range, so even black or white gets an accent; the text on it is
  always ink, and the accent stays at least 1.5:1 from the mode's own text so it never reads as text. A worker that fails, can't start or takes over 15 s hands the work to the page.
- Up to 4 accents are offered, with chroma of at least 0.05 and at least 1.5% of the image, at least 0.09 apart in
  OKLab, the most saturated first. A grey image offers none and keeps the kit.
- Accents snap by OKLCH hue: Rose 10°, Clay 32°, Paper 48° (the kit's orange is at 41°), Ochre 78°, Sand 95°, Olive
  115°, Sage 145°, Teal 195°, Slate 235° (also every greyish accent), Navy 262°, Violet 295°, Plum 335°. The 11
  tinted families were worked out in OKLCH and stored as fixed values.
- Decided while building, to review: the fitted accent reaches 3:1 on the background and the tiles, but not on
  oatmeal wells (`surface-raised`). With ink text on the accent, as in the kit, that can't be met in light mode: ink
  needs a light accent, oatmeal a dark one. The kit's own #DF5E27 is 2.1:1 on oatmeal too. The one place the accent
  meets oatmeal is the selected row's 3px marker; the row's ink number chip carries the selection without it.

**As built in 1.15 (Nov 3):** the ten tokens are registered with `@property` as colours and transition on `:root`
over 200ms, so every class that reads them eases with no per-element transitions; reduced motion turns it off. The
open project's stored tokens go on `<html>` as inline variables, and come off for a project without a theme. The
desktop window's own background follows `--bg` (permission `core:window:allow-set-background-color`). Follow project
is the new default Appearance and the first option in the status bar. Decided while building, to review:
`theme-boot.js` doesn't apply a cached project theme before first paint, as planned, because the app opens on the
Projects screen with no project; a project opened at launch eases from the kit into its own colours. After review: switching projects replaces the
open one in a single step, so the window never passes through the Projects screen or the kit's colours; the window
and the webview layer both take the background (Windows paints the webview's at the edges); a project's mode is read
apart from its tokens, so a project on the kit's colours can still prefer dark; and a `system` Appearance saved before
1.15 (every save wrote it, chosen or not) reads as the new default, Follow project, once. Native controls (scrollbars)
switch light and dark at once while the colours ease; left as is.

**Stored** in the project record's `theme` prop (docs/SBD_FORMAT.md).

- The computed tokens are stored rather than recomputed, so a newer generator never changes an approved look.
  Settings → Theme has Regenerate.
- Theme changes are ops, so they undo.
- A project without an image gets the default theme, and the schema 3 migration writes it into older files.

### B · Project onboarding

- New project: name and folder, then an optional logo or key image (drop it, browse for it or paste it).
- The theme previews live as soon as the image decodes, on the dialog itself and on a small shell in light and dark.
- Pick one of the 3–4 extracted accents (swatches with their hex in mono; arrow keys move between them), then light
  or dark. Create writes the image and the theme in the project's first op group.
- Settings → Theme has the same controls, plus:
  - Replace image.
  - A manual accent: a hex field and a picker, put through the same AA adjustment, with "picked → used" shown.
  - Regenerate, and Reset to default.
- 0.7 ships New project with name and folder only; the image steps come with the theme milestones.

**As built in 1.16 (Nov 3)** (src/app/theme):
- New project, once the file exists, opens "Set up <Project>": the image well (Choose image…, or drop or paste
  anywhere on the dialog), the accents as swatches with their hex (the kit's orange always first, arrow keys move),
  Light or Dark, and two small shells in the theme. The dialog itself wears the theme being chosen. Create writes the
  image and the theme in one op group; Skip or Escape writes nothing. Focus then goes to the workspace's section.
- Settings → Theme is a tile in Settings' default layout, between Project and Backups: the same controls, Replace
  image, a hex field (six digits or three) and a colour picker with "picked → used light, used dark", Use this accent
  (or Enter), Regenerate, and Reset to default. Each change is one op group.
- The image is a `media` record under the project, named by the theme's `image_id`. Replacing it, or Reset to
  default, sends the old one to the Trash in the same op group, as a frame's picture does.
- With no image and no accent, picking a mode stores a `default` theme: the kit's colours with that mode.
- While any modal dialog is open (onboarding, the sketch editor), the board takes no drops or pastes, and in the
  browser build a file dropped there never opens in the tab. A picture pasted anywhere on the dialog, or anywhere in
  Settings → Theme, is the image.
- Every change is worked out from the project as it is when the edit lands, so quick changes (two Replaces, an
  image still being read when Dark is picked) never undo each other. An image still being read when the project
  switches is dropped, and onboarding belongs to the project it opened for.
- `image_id` counts only when it names a live `media` record under the project, so a hand-edited file can never make
  Reset trash a frame's picture.
- Kevin, Nov 3: the screenshot tests (e2e/visual.spec.ts, 8 of them) are suppressed until the UI is ready to test
  properly. They and their baselines stay in the repo and run only with `SB_VISUAL=1` (the checkpoint workflow's
  baseline update run sets it). The behaviour tests and unit tests run as before.
- Kevin, Nov 4: they stay off, locally and in CI, until the polish step before the Bey County gate. There they come
  back with fresh baselines (Mac and Linux), made once the UI is final.
- Decided while building, to review: a Settings layout saved before 1.16 keeps its tiles, so Theme shows only after
  Layout → Reset to default (or from the Layout menu's tile list). A replaced theme image in the Trash restores on
  its own, without becoming the theme again.

### C · Navigation

Left sidebar, top to bottom:

- **Project switcher:** the open project as a dot in its accent plus its name. The list holds recent projects (dot,
  name and state), All projects… and New project…; archived projects leave it. Switching opens the other .sbd in
  place and runs the theme change.
- **Storyboard:** expands to its scenes inline, as "SC 04  Scene Name" with the number in JetBrains Mono, then
  "+ Add Scene". The active scene's marker is orange, and its bold name is the second cue.
- **Assets** (Phase 3, moved from Phase 2 on Nov 5), **Team** (Phase 3: who's on the project and, from Phase 9, what
  each person can see on the web), **Setup** (Phase 6: home of the bird's-eye view, setups listed by scene).
- **Production** (Phases 3 and 4): schedule, calendar, call sheets, locations, gear, and cast and crew. Its cast and
  crew tile and the Team section read the same person records.
- **Moodboard** (Phase 5, the canvas flow) and **Settings**.

Top-right project menu: History, Watermark Settings, Export Project, Archive Project. There is no Moodboard entry.

- Each section is a workspace, which is a saved D2 layout; Alt+1 to Alt+7 follow the sidebar's order. This replaces
  the top bar's workspace tabs (DESIGN.md updated Nov 2). The top bar keeps the S mark, the project name and the menu.
- Calendar, Notifications and Trash stay tiles that open in any workspace; Calendar is also in the Production
  layout. The status bar shows the unread count, and clicking it opens Notifications.
- The sidebar is a labelled navigation landmark, arrow keys move through it, and every item has a visible label.
- Sections and menu items whose phase hasn't come show that phase and are disabled, as the D1 placeholder tiles are.

### D · Export

src/features/export holds a registry of formats, so adding one is a new file plus one line in the registry.

- Each format declares an id, a label, its scopes (scene or project), its output (a file or a folder), default
  options and an options form.
- Its `run` reads the records in scope, leaving out the Trash, and writes through src/core/storage, the only code
  that touches the disk.
- Phase 1 formats:
  - PDF storyboard: Konva renders the pages and pdf-lib builds the file.
  - PNG image sequence: one image per frame, named by scene and shot number exactly as on the slate, so they sort.
  - Shot list CSV: a report with one row per shot.
- Later formats register the same way:
  - Project data as JSON and CSV, the lossless round-trip export (Phase 2).
  - Call sheet PDF (Phase 4) and deck PDF (Phase 5).
  - The web review package (Phase 9).
  - Resolve and Premiere markers (after Phase 10).
- Watermark Settings (project menu) sets the text, position and opacity. The watermark goes on PDF and PNG exports,
  and from Phase 9 on the web review copy. It's stored in the project record.
- Every format has a golden test: a fixture project goes in, and the output is checked (exact CSV text, PDF page count
  and text, PNG names and sizes).

### E · Desktop and web review

- Editing happens only in the desktop app, which is the source of truth. The web shows a review copy: compressed,
  read-only, and in the project's theme.
- **Reviewers.** Team members with reviewer access sign in by magic link and can suggest a shot or scene for deletion.
  For everyone signed in, it then shows grayed out with the suggester's name, and the suggester can withdraw it.
- **View-only link** (decided Nov 2): one optional link per project, off by default. It shows the storyboard and
  bird's-eye plans only, never call sheets or contact details, allows no suggestions or comments, and expires with
  the review copy.
- **Change file.** The producer downloads the pending suggestions as one change file (.sbdchanges, JSON, defined in
  docs/SBD_FORMAT.md). Each suggestion has a kind. Version 1 defines deletion only. Comments, reorders, edits, new
  shots and restore requests are reserved kinds: adding them later won't break older files, and an older app keeps
  kinds it doesn't know without applying them.
- **Review screen.** Drop a change file on the window, or use File → Import changes, to open the review screen. It
  shows one suggestion at a time: the frame, its scene and shot number, who suggested it and when, and Approve or
  Reject.
  - It flags items that changed after the reviewer saw them, and items that no longer exist.
  - Importing the same file twice adds nothing, and a file for another project is refused.
- An approved deletion is a `trash` op: the shot or scene goes to the Trash, recoverable, never hard-deleted. A
  rejection leaves the project unchanged and keeps the suggestion in the review log.
- The review screen is also Phase 7's approval queue for MCP suggestions, so it's built once, in Phase 7, and tested
  with fixture change files. Phase 9 adds the web side that writes them.

**Hosting the review copy**

- **The app:** one static web app (the `web/` entry, same React code) as its own Vercel project, separate from the
  prototype's, so `main` and the live prototype site stay as they are. It has no server code.
- **The data:** review copies live in Supabase, not in deployments. Publish uploads the records reviewers may see,
  compressed images (about 1600px on the long edge, around 200 KB a frame) and the theme. They go to a private Storage
  bucket and Postgres tables under row-level security. Publishing redeploys nothing, and no project ever gets a
  public URL of its own.
- **Suggestions:** they're Supabase rows until the producer downloads them as a change file.
- **What it costs:**
  - Vercel Hobby is free but for non-commercial use only; client productions need Pro, at $20 a month for one seat.
  - Supabase Free gives 500 MB of database, about 1 GB of files and 5 GB of transfer a month, but pauses a project
    after a week without visits, which breaks a review link a client opens later. Pro is $25 a month.
  - About $45 a month for client work, or $0 for testing and non-commercial use. A 300-frame board is about 60 MB
    as a review copy.
  - Prices are from third-party summaries dated 2026; check vercel.com/pricing and supabase.com/pricing before
    signing up.
- **What it needs:** a Supabase project and an email sender for the magic links (Supabase's built-in mailer is for
  testing only; Resend and Postmark have free tiers). A domain for the invite links is optional.
- **Self-hosting:** open-source users point the app at their own Supabase project and any static host.
- **Sooner, if wanted:** the review copy could split off as Phase 9's first milestone and move up to follow Phase 4.
  It needs only the storyboard, Team and the review screen.

### Two meanings of "archive"

| | Archived project | Trash (archived items) |
|---|---|---|
| What | A project's state: draft, active or archived, from the prototype | Deleted shots, scenes, frames, notes and media, and deletions approved in review |
| UI | Archive Project and Unarchive in the project menu; an Archived filter on the Projects screen; a banner when an archived project is opened | The Trash tile: filters, Restore, Empty Trash |
| Code | `ProjectState`: `draft`, `active`, `archived` | `trash` and `restore` ops; trashed records filtered out |
| File | `state` prop on the project record | `trashed_at` and `trashed_by` on every record |

- The item archive is renamed the Trash in the UI, the code and the file, because Archive Project keeps the word.
  Mac and Windows users already read Trash as "deleted, recoverable until emptied", which is exactly how it works.
  0.4 hasn't built the columns yet, so the rename costs nothing.
- An archived project isn't read-only; it only leaves the switcher and Recent. Archiving it is an op, so it undoes.
- New projects start as drafts, as in the prototype.

### F · Synced folders (decided Nov 2)

A .sbd in iCloud Drive, Dropbox, Google Drive or OneDrive works, but sync services don't carry SQLite's locks and can't
merge a database. The rollback journal (not WAL) keeps the file whole between edits, so the risks are a project open on
two computers (conflicted copies), a newer version replacing the file while it's open (edits written to a file that's
gone), and, rarely, an upload caught mid-write. Approved for Phase 1:

- Detect synced folders and say so once, at New and at Open: it works, but open it on one computer at a time. New
  project starts in a local folder when Documents is synced (iCloud's Desktop & Documents).
- A lock file next to the .sbd names the computer that has it open and when, refreshed while open. It syncs, so a
  second computer sees it and warns before opening.
- Before every write, Rust checks that the path still names the file it has open. If a sync replaced it, writing
  stops and the app reopens the new version.
- Backups of a synced project go to a local folder on this computer, not next to the project; Settings → Backups has
  Show backups and a setting to keep them next to the project instead. Unsynced projects keep `Backups/` beside the
  .sbd.
- Deferred to Phase 8, only if moving a live project between computers becomes a real need: editing a local working
  copy and writing the whole file back.
- As built in 1.3 (Nov 3): detection reads what each service writes on disk, never the network. On a Mac that's the
  `com.apple.file-provider-domain-id` attribute every File Provider service (iCloud Drive with Desktop and Documents,
  current Dropbox, Google Drive, OneDrive, Box) puts on its folders, plus the iCloud Drive and CloudStorage locations
  for older installs. On Windows it's the cloud-files attributes plus OneDrive's, Dropbox's and iCloud's known folders.
  The note is an info notice (ink outline), once per project. New project starts in Documents, or in
  `Movies/Storiiboard` (`Videos\Storiiboard` on Windows) when Documents is synced, or the home folder if that's synced
  too.
- As built in 1.4 (Nov 3): a synced project's backups go to the app's data folder, `Backups/<Project> <key>/`, keyed
  by the file's new `file_id` meta value and its path. Settings → Backups has Show backups and "Keep synced projects'
  backups next to them" (off by default). Open backup puts its copy beside the project either way. The online backup
  API wasn't needed: `VACUUM INTO` copies a 200 MB project in 0.33 s here, off the window's thread, and the step-wise
  API took the same time. Sizes with real images get measured again in 1.10.
- As built in 1.10 (Nov 3): pictures are stored at most 2560px on the long edge, as Display P3 JPEG (PNG when they
  have see-through pixels), each with a 640px thumbnail. Measured through WebKit, the Mac app's engine, on the 26 film
  stills in the design kit and scaled to a 2560×1440 frame: about 560 KB a frame plus a 50 KB thumbnail. Chromium, the
  Windows engine, writes about 40% less. A 300-frame project is 180 MB, and its backup copy takes 0.37 s; 1000 frames
  are 603 MB and 1.16 s. Under the current keep rule (the last 12 plus one a day for 14 days, so up to 26 copies),
  backups reach 4.7 GB at 300 frames and 15.7 GB at 1000, so new keep defaults went to Kevin with the 1.10 report.
  A picture replaced in a frame stays in the file, since History can bring it back.
- Decided Nov 3 (Kevin, from the 1.10 report), built in 1.10b: on a Mac each backup is an APFS clone, taken between
  saves so it's consistent, and it shares the project's unchanged data. Where a clone isn't possible (Windows, exFAT,
  another volume) it's a full copy made with SQLite's step-by-step backup API, because no backup may hold up an edit
  more than about 100 ms and `VACUUM INTO` held one for 1.2 s at 1000 frames. Full copies share a 5 GB cap per
  project: over it the oldest go first, but the 3 newest always stay. The keep rule stays 12 plus 14. CLAUDE.md's
  "never a raw file copy" now names clones as the consistent way on a Mac.
- As built in 1.10b (Nov 3): at 1000 frames (614 MB), with an edit every 5 ms, a clone took under 15 ms and held an
  edit at most 29 ms; a full copy took about 3 s and held one at most 25 ms, against a 14 ms commit. The copy has to
  flush itself to disk between steps: left to pile up, its writes made an edit's own sync wait past 100 ms. The cap
  counts each backup's own space (APFS's private size), so clones barely count.
- Decided Nov 3, for 1.21: Settings → Storage gets "Clean up old pictures". It shows how much space pictures that only
  History still uses take up (a picture replaced in a frame, for example), and after a confirm removes them for good.
  History then shows those steps as "picture removed".

### History, versions and backups

One model replaces three overlapping ones, and "snapshot" is dropped as a word.

| | What it's for | Where | Kept |
|---|---|---|---|
| **History** (the op log) | Undo and redo; the History panel (every change: field, before and after, who, when); Notifications | Inside the .sbd | For the life of the project. Empty Trash removes those items' data from it |
| **Named versions** | A point to come back to, such as "Board sent to client" or "Locked for shoot" | Inside the .sbd, as a named point in History | Until someone deletes it |
| **Backups** | Getting back a lost, damaged or wrongly edited file | `Backups/` next to the .sbd: APFS clones on a Mac, full copies elsewhere; for a project in a synced folder, a local folder on this computer (F) | The last 12, plus one a day for 14 days (Settings); within 5 GB by the space each takes alone, the newest 3 always |
| **Migration backups** | Undoing a schema upgrade | Next to the .sbd | Never pruned |
| **Review copies** | What reviewers see on the web | Supabase | 30 days after the last shoot day |

- Open version copies the project, restores the copy to that point (0.5b's restore, a new op group), and opens the
  copy as a separate project, as Open backup does. It reuses the History engine, so there's one way to go back in time.
- CLAUDE.md's "automatic snapshots are pruned after 30 days" is gone: backups are the automatic restore points.
- The History panel and named versions come in Phase 1. Notifications (Phase 3) adds suggestions, comments and read
  state to the same feed.

## Claude Code hand-off

Claude Code builds one phase at a time on the `v2` branch, one pull request per milestone. The PM checks each PR against
the phase's exit criteria before Kevin merges.

**Repo setup**

1. Create a v2 branch. Move the current files into /prototype as read-only design reference.
2. Scaffold the app at the repo root. Add docs/PLAN.md (this file) and CLAUDE.md.
3. Turn on GitHub Actions so every PR builds a Mac and a Windows installer before any feature work.
4. Keep the repo private until Phase 8, then make it public with a license, README and contributing guide.

**Working rhythm**

- Start every phase in plan mode; Kevin approves the plan, then Claude Code builds.
- One PR per milestone, small enough to test in 15 minutes from its installer build.
- CI must be green; every PR adds or updates a test for the flow it touches.
- Claude Code updates the status in docs/PLAN.md at the end of each PR.

**Prompt template for later phases**

```
Read CLAUDE.md and docs/PLAN.md. Phase [N]: [name].
Goal: [one sentence]. Exit criteria: [list from PLAN.md].
Reference screens in /prototype: [files].
Plan first, then build in PRs of one milestone each.
```

## Decisions

Audience is settled: Kevin first, then a free open-source desktop app for filmmakers, producers and creators, with a web
companion for everyone on set. Three calls unblock Phase 0; the rest can wait until Phase 8.

| Decision | Options | Recommendation | Needed by | Status |
|---|---|---|---|---|
| Desktop shell | Tauri (small, uses each OS's browser engine) or Electron (bigger, identical everywhere) | Tauri; switch only if the canvas or video misbehaves on one OS | Phase 0 | Tauri (Nov 1, 2026) |
| Repo | v2 branch in the same repo, or a fresh repo | v2 branch, prototype kept in /prototype | Phase 0 | v2 branch (Nov 1, 2026) |
| Inside the .sbd | One SQLite database, or a zipped folder of JSON files | SQLite: crash-safe and fast; JSON export keeps it open | Phase 0 | SQLite (Nov 1, 2026) |
| License | MIT (anyone can do anything, including closed forks) or GPL (forks must stay open) | MIT for maximum reach; GPL if improvements should flow back | Phase 8 | Open |
| Patreon model | Donations only, or paid tiers that unlock features | Donations only: perks like early builds, templates and a Discord, never locked features. Paid features would break Open-Meteo's free terms | Phase 8 | Open |
| Code signing | Pay for Apple and Windows signing, or ship unsigned | Sign the Mac build at least; unsigned apps show scary warnings | Phase 8 | Open |
| Web companion hosting | Kevin hosts one site for everyone, or each production hosts its own | Host it for Kevin's productions first, on Vercel Pro and Supabase Pro (about $45 a month for client work), with a self-host guide; decide on an open hosted service once costs are known | Phase 9 | Open |

### Open questions

Settled Nov 2, second round (the last three by Kevin):

| Question | Decision |
|---|---|
| Trashing a scene: do its shots go with it? | Yes, in the same op group, so one restore brings the whole scene back. An approved scene deletion from review works the same way |
| Empty Trash: is it final? | Yes, after a confirm. It removes the records, their media and their data in older ops, so named versions lose them too; backups keep them until they're pruned |
| Who sees the full Trash on the web? | It's a Team permission, on by default for the project owner and the production and direction departments |
| Backup size: up to 26 full copies sit next to the project, and they sync if it's in Dropbox | Keep the defaults, and show the Backups folder's size next to the two numbers in Settings |
| CLAUDE.md's 30-day automatic snapshots | Dropped. See History, versions and backups |
| The prototype's Archive was for whole projects | Kept as Archive Project, a project's state, in 0.7. The item archive becomes the Trash |
| Light and dark: per project or per person? | Both. The project sets its mode, and each person can override it; "Follow project" is the new default |
| Sidebar and workspaces | Each section is a workspace. A Production section (schedule, calendar, call sheets, locations, gear, cast and crew) sits between Setup and Moodboard |
| The kit's orange on paper is 2.93:1 | The default theme's accent is #DF5E27 (3.01:1); the logo keeps #E0612B as a fixed brand token |
| View-only links | Allowed: one optional link per project, off by default, storyboard and bird's-eye only, no call sheets or contacts, no suggestions, expires with the review copy |

Still open:

| Question | Recommendation | Needed by |
|---|---|---|
| Frames and notes aren't record types yet | Phase 1 planning decides whether a frame is its own record or a shot's image, and adds a note type | Phase 1 |

## Risks

| Risk | Fallback |
|---|---|
| Ten phases is a long build; it may never feel finished | The desktop app goes public at Phase 8 even if the web companion slips |
| Camera RAW formats such as BRAW and R3D need maker SDKs that ffmpeg doesn't include | Accept common formats and ProRes first; RAW users import a reference export; maker SDKs later |
| Rendering or video playback differs between Mac and Windows under Tauri | Test both in CI from Phase 0; Electron is the escape hatch |
| The web companion leaks phone numbers or addresses | Private invite links, contact details only for people on that sheet, row-level security with tests, snapshots that expire |
| Free location services throttle or change terms | Cache every lookup; the app keeps working without them; Google key as backup |
| Google Drive links break or hit quota | Support Dropbox first; show a clear error and let users relink files by hand |
| AI proposes a wrong change | AI can only suggest; a person approves everything |
| Big image boards get slow | Thumbnails on the canvas, originals only on export |
| Claude Code drifts or breaks earlier work | CLAUDE.md rules, CI tests, one milestone per PR |
| Open-source support load after release | Issue templates, a clear README, a Patreon tier for priority requests |
| Limited build hours alongside client work | Each phase is usable on its own |

## Next steps

- [x] Kevin confirms Tauri and the v2 branch
- [x] Remove the client-side password from the v2 prototype
- [x] Kevin keeps the old password as is (Nov 1, 2026); it stays readable in main, git history and the live site
- [x] Create the v2 branch
- [x] Add CLAUDE.md and docs/PLAN.md to the v2 branch (first PR)
- [x] Run the Phase 0 kickoff in Claude Code (plan mode)
- [ ] Pick the pilot shoot days for the call sheet phase
- [ ] Before Phase 8: choose the license, Patreon tiers and signing

## Sources

Open-Meteo terms · Nominatim usage policy · Google Maps Platform pricing · tldraw pricing · Electron vs Tauri, 2026 ·
The data model behind Notion · MCP transports specification (links in the source PDF).
