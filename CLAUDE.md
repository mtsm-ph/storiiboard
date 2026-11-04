# Storiiboard — CLAUDE.md

## What this is
- Open-source pre-production tool for filmmakers, producers and content creators.
- Mission: production tools people own, instead of renting them from corporations.
- Core: fast storyboarding. Every shot links to its scene, location, shoot day, people and gear.
- Production flows out of the storyboard: schedule, call sheets, gear lists, bird's-eye plans.
- Three surfaces:
  - Desktop app (Tauri): where production decisions are made; works offline.
  - Web companion: cast, crew and clients view, comment, suggest, mark availability.
  - MCP server: AI assistants read the project and propose changes.
- First user is Kevin Matos, a working DP. Build for real shoots, not demos.

## Read first
- docs/PLAN.md: current phase, scope and exit criteria.
- Build only the current phase. Ask before starting anything outside it.
- design/DESIGN.md and design/tokens set the look. /prototype is only an inventory of screens and flows: keep its
  features, never its look, and never import from it.

## Film vocabulary (use it correctly)
- Shot sizes: EWS, WS, MS, MCU, CU, ECU, insert.
- Lens focal length in mm; sensor width in mm; aperture as T-stop.
- Scene headings: INT/EXT, DAY/NIGHT, scene number; shot numbers 1A, 1B, 1C.
- Setup = one camera position and lighting state; several shots can share one.
- Call time, crew call, shooting call, wrap, company move.
- Departments: direction, camera, grip and electric, art, HMU, wardrobe, sound, production, post, cast, client.
- Editors need scene and shot numbers that match the slate exactly.

## Stack
- Shell: Tauri 2 (Rust). UI: React, TypeScript (strict), Vite, Tailwind.
- State: Zustand. Every canvas: react-konva.
- Project file: SQLite through Rust commands (rusqlite) in src-tauri; SQL and schema live in src/core/storage.
- Video: ffmpeg sidecar, LGPL build, for proxies, stills and trims.
- PDFs: pdf-lib. Sun times: SunCalc. 3D (Phase 10): three.js through react-three-fiber.
- Web companion: same React code, Supabase backend, Vercel hosting.
- Tests: Vitest (unit), Playwright (end to end). Dev builds opened with `?files=memory` keep real projects in the page
  (sql.js, dev only, src/app/fileAccess.ts), so end-to-end tests can create, edit, reload and reopen projects.
- CI (Kevin, Nov 4): every PR runs quick checks on Linux (lint, types, unit tests, Rust tests); a newer push cancels
  the outdated run. A checkpoint run (.github/workflows/checkpoint.yml) adds the end-to-end smoke set
  (e2e/smoke.spec.ts) on Linux and in WebKit on a Mac, and the Mac and Windows installers.
- A failing functional or data-safety test gets fixed, never skipped.

## Repo layout
- src/app: screens and routing.
- src/features/<tool>: storyboard, video, birdseye, locations, people, gear, schedule, callsheets, moodboards, decks, cloud, availability, suggestions (the review screen), history, trash, export.
- src/core/model: record types and schema.
- src/core/ops: operations, undo, history.
- src/core/storage: .sbd read and write. The only code that touches the disk.
- src/core/net: weather, geocoding, maps, cloud links.
- src/core/checks: consistency checks shared by the app and MCP.
- src/ui: shared components, theme, bundled fonts, plan icons.
- design: DESIGN.md, tokens and logo sources, copied from Kevin's design kit (the kit folder itself stays out of git).
- src-tauri: Rust shell, .sbd file association, ffmpeg sidecar.
- mcp: MCP server.
- web: web companion entry point.
- docs: PLAN.md, SBD_FORMAT.md, MCP.md.

## The .sbd project file
- One project = one .sbd file = one SQLite database.
- It holds all records, the edit log, images and thumbnails.
- Video stays outside the file: a linked path or cloud link, plus a cached thumbnail.
- Store media paths relative to the .sbd when possible; absolute otherwise.
- Every table has id (UUID v4), created_at, updated_at.
- The meta table holds schema_version. Migrations live in src/core/storage/migrations.
- Copy the file to a backup before running any migration.
- Backups: every 5 minutes, only if the project changed, write a copy named `<Project> YYYY-MM-DD HH-mm.sbd`
  (<Project> is its file name).
  - Where: in `Backups/` next to the .sbd. For a project in a synced folder (iCloud Drive, Dropbox, Google Drive,
    OneDrive), in a local folder on this computer instead, so copies don't upload every 5 minutes or sync into
    conflicts. Settings → Backups has Show backups, and a setting to keep synced projects' backups next to the project.
  - How: on a Mac, an APFS clone of the .sbd, taken between saves so it's consistent; it shares unchanged data with
    the project, so it takes almost no space. Where a clone isn't possible (Windows, exFAT, another volume), a full
    copy with SQLite's step-by-step backup API, so no edit waits more than about 100 ms. Never a raw file copy.
  - Keep the last 12 copies plus one per day for 14 days, and delete older ones. Both numbers are in Settings.
    Backups share a 5 GB cap per project, each counted by the space it alone takes (all of a full copy, next to
    nothing for a fresh clone): over it, delete the oldest first, but always keep the 3 newest.
    Pruning touches only this project's own backups.
  - "Open backup" opens a copy as a separate project; it never overwrites the original without asking.
  - Per-edit saving stays as it is; backups are an extra safety net.
- Synced folders (Phase 1): the .sbd works in iCloud Drive, Dropbox, Google Drive or OneDrive, but must be open on one
  computer at a time.
  - Detect synced folders; say so once at New and at Open. New project starts in a local folder when Documents is synced.
  - A lock file next to the .sbd says which computer has it open, so a second computer can warn before opening it.
  - Before every write, check that the file on disk is still the one open. If a sync replaced it, stop writing and
    reopen the new version; never write to a file that's no longer there.
- .sbdpack = zip of the .sbd plus all linked media ("Collect project").
- .sbdchanges = a change file of suggestions from the web review copy (see Review below).
- Document every schema change in docs/SBD_FORMAT.md.
- JSON and CSV export must always round-trip without data loss.

## Data model
- Every record has: id, type, props, parent_id, ordered children.
- Changing a record's type never drops its props.
- Records: project, scene, shot, stroke, note, setup, media, location, person, character, department, gear_item, shoot_day, callsheet, plan, plan_item, board, board_item, design, comment, suggestion, availability.
- A shot links to: one scene, at most one location, shoot_day and setup, and many people, gear items and media.
- Views (storyboard, shot list, schedule, call sheet, deck) read records. They never copy data.
- Rollups (day totals, a location's shot list) are computed, never stored.
- Deleting a frame, shot, scene, note or media item moves it to the Trash: trashed_at and trashed_by are set on the
  record through an op, so undo brings it back. Restore is an op too.
- Views, rollups, call sheets, checks and MCP reads skip trashed records unless the caller asks for them.
- Two different things, never mixed in UI, code or file: the Trash (deleted items) and an archived project (the
  project record's state prop: draft, active, archived; "Archive Project" in the project menu).
- Users can add custom props to shots, locations and people.

## Edits, undo and autosave
- Every change is an operation: id, record_id, kind, before, after, author, timestamp.
- The UI, MCP, imports and web suggestions all apply edits through src/core/ops.
- Undo and redo walk the op log. Every canvas action is undoable. ⌘Z undoes project edits only, never a layout change
  (the Layout menu has Undo layout change for those).
- The log is append-only; undo never destroys history. Every undo, redo and restore is an op group of its own, saved
  like any edit and linked to the group it undid, redid or restored to. A new edit after an undo clears ⌘⇧Z's redo
  stack, but the undone work stays in History and can be restored.
- Restore to any earlier point in History is a new op group too, so it can be undone.
- Each op commits to SQLite in a transaction right away. There is no Save button.
- Going back in time, one model ("snapshot" is not a term here):
  - History is the op log, inside the .sbd, kept for the life of the project. Undo, the History panel and
    notifications read it. Nothing is ever deleted from it; only Empty Trash removes trashed records' data.
  - Named versions are named points in History, inside the .sbd, kept until deleted. Open version copies the project,
    restores the copy to that point and opens it as a separate project.
  - Backups are copies outside the .sbd (see above), for a lost or damaged file: APFS clones on a Mac, full copies
    elsewhere. A clone shares the project's unchanged blocks on disk, so it covers a damaged or wrongly edited file,
    not a failing drive.

## Tool rules
- Storyboard: keyboard-first; "/" menu inserts frame, scene, note, location; drag to reorder; auto shot numbers.
- Video: play proxies, never originals. Comma and period step frames; I and O set in and out.
  - Crop, then grab a still or a short clip straight into a frame.
  - Proxies are H.264 from the hardware encoder (VideoToolbox on Mac, Media Foundation on Windows).
- Bird's-eye view: top-down plan in real units (meters or feet, a setting).
  - Items: walls, doors, windows, set pieces, cast marks and paths, cameras, lights, flags, diffusion.
  - Camera field of view = 2 * atan(sensor_width / (2 * focal_length)).
  - Layers per department: camera (DP), lighting (gaffer), grip, art, cast blocking.
  - One plan per scene setup, linked to its shots.
- Call sheets: generated per shoot_day from linked records, with editable notes; PDF and web.
  - Include call times, scenes, cast with character and HMU times, crew by department, locations with map and parking,
    nearest hospital, weather, sunrise and sunset, golden hour, gear and notes.
- Moodboards: one per department; they link to scenes, characters and locations.
- Cloud links: one shared link per project; list, download and relink media.
- Missing media: flag it clearly and offer relink. Device-wide file search is a later phase.
- Script import: Fountain, Final Draft (.fdx) and PDF.
  - Parse scene headings by rule, not AI; create scene, location and character records.
  - AI breakdown (props, wardrobe, vehicles, stunts, VFX) arrives only as suggestions.
- 3D set (Phase 10): react-three-fiber blockout built from the bird's-eye plan; look through any camera.
  - Export glTF (.glb) with cameras and KHR_lights_punctual lights.
  - Open in Blender: run the user's installed Blender in the background with a bundled Python script.
  - Never bundle Blender. Ship a Storiiboard application template with a simplified layout.
- Trash (Phase 1): trashed frames, shots, scenes, notes and media, filtered by scene and type; restore with one
  click; "Empty Trash" asks to confirm, then deletes for good.
- History (Phase 1, project menu): every step, undos and redos included, and every change to an item (field, before
  and after, who, when). Restore the project from any point, or an old value; either is a new op group. Name a version
  from here.
- Notifications (Phase 3): the History feed plus suggestions and comments: what changed, who, when, with a link to
  the item. Read and unread state per user, stored in the .sbd; marking an item read is not an op.
  - Unread count; filters for all, unread and the current scene; Mark all read. Filtered to one item, it is that
    item's history.
- Calendar (Phase 3): month and week views of shoot days and availability, plus a shoot schedule list. Picking a day
  narrows the list; each day shows its scenes, its location's status and how many crew have confirmed.
- Calendar, Notifications and Trash are tiles any workspace can open. Calendar is in the Production workspace's default
  layout; Notifications and Trash are in none.
- Navigation (D3): left sidebar with the project switcher, then Storyboard (its scenes inline, "SC 04  Scene Name",
  and "+ Add Scene"), Assets, Team, Setup (the bird's-eye view), Production (schedule, calendar, call sheets,
  locations, gear, cast and crew), Moodboard, Settings. Each section is a workspace.
  - Project menu, top right: History, Watermark Settings, Export Project, Archive Project.
  - Switching projects opens the other .sbd in place, without reloading the window.
- Project themes (Phase 1): colours come from the project's logo or key image, worked out on the device.
  - The accent is the most saturated usable colour, adjusted only as far as AA needs. Backgrounds come from 12
    curated hue families, light and dark, so no theme can be unreadable.
  - The theme's tokens are stored in the project record; a project without an image uses the default theme.
  - Run every generated theme through the axe checks, light and dark.
- Export (Phase 1): src/features/export is a registry; a format is one file plus one line. Per scene or whole
  project. Exports skip the Trash, and files go to disk through src/core/storage.
- Review (Phase 7 desktop, Phase 9 web): web suggestions come back as a change file (.sbdchanges, in
  docs/SBD_FORMAT.md). Importing one opens the review screen; nothing applies without a person approving it, one by
  one. An approved deletion is a trash op, never a hard delete.

## Network rules
- Weather: Open-Meteo, no key, non-commercial use only; credit it on call sheets (CC BY 4.0).
- Geocoding: Nominatim only when the user presses Search; at most 1 request per second;
  app name in the User-Agent; cache results in the .sbd; never autocomplete.
- Google Maps only with the user's own key from Settings.
- Dropbox: a public folder link with dl=1 downloads as one zip.
- Google Drive: "anyone with the link" folders through the Drive API with a project API key.
- Cache every lookup in the .sbd with a fetched_at timestamp.
- Everything except lookups, cloud links and publishing works offline.

## Web companion
- Read-only views: call sheets, compressed storyboard (images only, no video, no tools), latest bird's-eye plans.
- Interactive: comments, suggestions, availability (whole dates only, no hours).
- Main navigation includes Calendar, Notifications and Trash.
  - Cast and crew see only their own days and updates.
  - Team members with Trash access see the full Trash. A restore from the web is a suggestion for the desktop.
- The desktop app publishes a review copy: compressed, read-only, in the project's theme. The web never edits the .sbd.
- Team members with reviewer access can suggest deleting a shot or scene; it shows grayed out until decided.
- Suggestions and comments come back to the desktop as a change file the producer downloads and imports.
- Access by per-person invite link (magic link). The one exception is an optional view-only link per project: off by
  default; storyboard and bird's-eye plans only; never call sheets or contact details; no suggestions or comments; it
  expires with the review copy.
- Contact details are visible only to people on that call sheet.
- Supabase row-level security on every table, with tests for each policy.
- Company workspaces: roles owner, approver (CEO, marketing), creator, crew, editor, cast, client.
- Published review copies expire 30 days after the last shoot day by default.

## MCP server
- Transports: stdio for Claude Desktop and Claude Code; local HTTP bound to 127.0.0.1 with an Origin check and a token.
- Read tools: project summary, scenes, shots, schedule, call sheets, people, gear, locations, plans, suggestions.
- Read tools leave out trashed records unless the call asks for them.
- Write tools only create suggestions. A person approves them in the app.
- The check tool runs src/core/checks and returns findings.
- The script tool reads an imported script and proposes scenes and a breakdown as suggestions.
- Checks:
  - Cast called on a day they marked unavailable.
  - A shot needs gear that is not on that day's list.
  - Golden-hour shot scheduled at midday; exterior on a day with rain forecast.
  - Location missing address, contact or parking note.
  - Department missing from a call sheet that needs it (for example, sound on dialogue scenes).
  - HMU time too short before a cast member's call.
  - Storyboard lens differs from the camera lens in the bird's-eye plan.
- Never send project data anywhere except the client that called the server.
- Optional in-app chat uses the user's own key (Anthropic, OpenAI, Gemini, OpenRouter) from the OS keychain.

## Security and privacy
- No secrets in code or the repo. User keys live in the OS keychain.
- Call sheets hold phone numbers and addresses: treat them as private data.
- Never log personal data.

## Code style
- TypeScript strict; no `any`.
- Small components, one feature per folder.
- Name things with the film terms users already know.
- Comment the why, not the what. People will fork this code.
- Accessible: everything keyboard reachable, labels on icon buttons, AA contrast.

## Design
- Full rules: [design/DESIGN.md](design/DESIGN.md); values: design/tokens. Build from src/ui components and the semantic token classes (bg-surface, text-text-muted…); no hex values or --sb-* names in components.
- Feel: a technical film poster printed on paper. Boxed tiles, 1.5px rules, 10px uppercase mono labels, gauges, bold type.
- Light: paper #EEE9DF with grain, oatmeal #C9C1B1 for wells and selected rows, ink #16150F, muted #5E5A52.
- Dark (data-theme="dark" on <html>): abyssal #1B2632, panels #2C3B4D, paper text, muted #A9B2BC; tile outlines #0E151C; the top bar keeps paper outlines.
- The accent (#DF5E27 in the default theme) only for: active workspace (the active sidebar section), selected frame, playhead, primary buttons, active scene marker. Never a large fill. Text on the accent is ink.
- The logo uses Signal Orange #E0612B, a fixed brand token, never the accent.
- Project themes (Phase 1) swap colour tokens only: the accent changes and backgrounds tint. The logo, warning, golden hour and department colours never change.
- Truffle #A35139 for warnings (paper text); Burning Flame #FFB162 for golden hour (ink text).
- Department colours are tags, never state. Selection is an ink fill. Shot status is a shape: Have ■, Need to shoot □, Source ◩.
- Inter Tight for UI; JetBrains Mono for every technical value (lens mm, T-stop, shot and scene numbers, times, timecode).
- No radius and no shadow inside the app. Tiles: 26px title bar, 8px gaps; 44px top bar, 248px sidebar, 24px status bar.
- The S mark stands alone, never with the wordmark; solid S at 32px and below; never recolour the dots.
- AA: muted text never sits on oatmeal; focus rings are ink, never orange (on an ink fill use text-inverse, on orange use accent-contrast); orange marks always pair with a second cue.
- Fonts are bundled in src/ui/fonts; never load fonts from Google or any CDN.

## Workflow
- Start each phase in plan mode and wait for Kevin's approval.
- One PR per milestone, small enough to review in 15 minutes.
- Every PR adds or updates tests for the flow it touches.
- Before saying done: `npm run lint && npm test && npm run e2e`. On Windows, run the end-to-end tests with
  `--project=chromium` (WebView2's engine): Playwright's Windows WebKit lacks OffscreenCanvas, which Safari has, so
  WebKit runs on a Mac.
- Ask before adding a dependency or changing the .sbd schema or the MCP tools.
- Update the status in docs/PLAN.md at the end of each PR.
