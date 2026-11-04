# Storiiboard 2.0 — Program Plan

Source: "Storiiboard 2.0 — Program Plan & Claude Code Hand-off" (PDF, Oct 31, 2026, Kevin Matos), kept unchanged at the repo root.
CLAUDE.md holds the working rules. This file holds scope, phases, gates and status.

## Status

| | |
|---|---|
| **Current phase** | **Phase 1 · Storyboard**: plan approved Nov 2; 1.10b done; 1.11 in review |
| Phase 0 state | **Done.** Gate passed on the installers, Nov 2 (Mac: every step; Windows: create and double-click) |
| Branch | `v2` |
| Planned start | Nov 2, 2026 |
| Last updated | Nov 2, 2026 (synced-folder decisions) |

| Phase | State |
|---|---|
| 0 · Foundation and .sbd | Done (Nov 2) |
| 1 · Storyboard | **Current**, building |
| 2 · Video and images | Not started |
| 3 · Production data | Not started |
| 4 · Call sheets | Not started |
| 5 · Bird's-eye view | Not started |
| 6 · Moodboards and decks | Not started |
| 7 · AI assistant | Not started |
| 8 · Cloud links and release | Not started |
| 9 · Web companion | Not started |
| 10 · 3D set and Blender | Not started |

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
| 1.11 Frame images: drop, paste, browse, crop; original's path kept as a pointer | #27 | In review |
| 1.12 Drag to reorder; "/" menu | | Not started |
| 1.13 Sketching | | Not started |
| 1.14 Theme generator: 12 families, OKLab accents, AA fit, in a Web Worker | #31 | Done |
| 1.15 Theme switching, Follow project | | Not started |
| 1.16 Onboarding and Settings → Theme | | Not started |
| 1.17 Script import: Fountain and FDX | | Not started |
| 1.18 Script import: PDF | | Not started |
| 1.19 Custom fields on shots | | Not started |
| 1.20 Trash tile | | Not started |
| 1.21 Empty Trash; Settings → Storage, Clean up old pictures | | Not started |
| 1.22 History tile | | Not started |
| 1.23 Named versions (schema 4) and Open version | | Not started |
| 1.24 Export registry, shot list CSV, PNG sequence, Watermark Settings | | Not started |
| 1.25 PDF storyboard | | Not started |

Gate: Kevin boards a real Bey County scene in one sitting, from script import to finished frames, and exports it as
a PDF.

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
    until 0.7, so the list is tested against a project file in unit tests. Setup's setups by scene come in Phase 5
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
  - The dialog plugin (tauri-plugin-dialog 2.8.3) was approved Nov 2. Only its Open and Save dialogs are allowed.
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
| 2 · Video and images | Playback copies, frame stepping, in and out, crop, still and clip capture, attachments, Assets section | A still from a reference clip lands in a frame in a few clicks |
| 3 · Production data | Locations, cast and crew, departments, gear lists, shoot days, Team section, Calendar and Notifications tiles | A real shoot's people, places and gear are entered |
| 4 · Call sheets | Call sheet per day with weather, sun times, map and hospital; PDF | Used on a real shoot day |
| 5 · Bird's-eye view | Setup section: top-down plans with walls, cast, cameras with true field of view, lights, department layers | A gaffer plans a real setup with it |
| 6 · Moodboards and decks | Department moodboards, pitch decks from frames | A deck built in under an hour |
| 7 · AI assistant | MCP server, mistake checks, review screen for AI suggestions and imported change files | The checks catch a real scheduling or gear mistake |
| 8 · Cloud links and release | Dropbox and Google Drive links, Collect Project, signed installers, public repo, Patreon | A stranger installs it and opens a shared project |
| 9 · Web companion | Review copy in the project's theme: call sheets, compressed storyboard, bird's-eye viewer; availability, comments, suggested deletions downloaded as change files, company workspaces, Calendar, Notifications and Trash | Cast and crew get their call sheet from the site and send a suggestion |
| 10 · 3D set and Blender (July to September 2027) | 3D set preview, glTF export, Open in Blender, the simple Blender layout | A DP checks a real setup through the 3D camera before the shoot |

### Phase 4 notes

- When a scene goes on an issued call sheet, its shot numbers lock automatically (Kevin, Nov 3): slates and the script
  supervisor work from them from then on. The lock is the same `numbers_locked` prop the Scenes tile sets (1.6), set
  in the op group that issues the call sheet, so undoing the issue unlocks it again. Unlocking by hand stays possible.

### Phase 5 notes

Field of view is `2 * atan(sensor_width / (2 * focal_length))` (CLAUDE.md), so both numbers have to be real (Kevin,
Nov 3):

- **Camera body per project, with its sensor width.** For example, Sony FX3, full frame, 35.6mm. The bird's-eye
  cameras and the 3D preview read it, and a project can list more than one body (A and B cameras).
- **Lenses can be zooms and anamorphic.** A zoom records its range and the focal length used for the shot. An
  anamorphic lens records its squeeze factor, such as 1.33x or 2x, which widens the horizontal field of view by that
  factor at the same focal length. The shot's `lens_mm` stays the focal length used; the range and squeeze are new
  props, proposed for approval in Phase 5's plan.

### Phase 8 release checklist

- [ ] Run the Phase 0 gate's force-quit, undo-after-restart and backup steps on Windows (Phase 0 ran them on the Mac
  only).
- [ ] Choose the license, Patreon tiers and signing (also in Next steps).

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
| src/ui/icons/plan (68 SVGs) | Literal ink strokes; oatmeal and white fills; 6 orange and 3 Truffle strokes. The ink strokes already disappear on a dark plan | Phase 5 recolours them as they render: ink, oatmeal, white and orange become tokens, and department fills stay fixed |
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

### C · Navigation

Left sidebar, top to bottom:

- **Project switcher:** the open project as a dot in its accent plus its name. The list holds recent projects (dot,
  name and state), All projects… and New project…; archived projects leave it. Switching opens the other .sbd in
  place and runs the theme change.
- **Storyboard:** expands to its scenes inline, as "SC 04  Scene Name" with the number in JetBrains Mono, then
  "+ Add Scene". The active scene's marker is orange, and its bold name is the second cue.
- **Assets** (Phase 2), **Team** (Phase 3: who's on the project and, from Phase 9, what each person can see on the
  web), **Setup** (Phase 5: home of the bird's-eye view, setups listed by scene).
- **Production** (Phases 3 and 4): schedule, calendar, call sheets, locations, gear, and cast and crew. Its cast and
  crew tile and the Team section read the same person records.
- **Moodboard** (Phase 6) and **Settings**.

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
  - Call sheet PDF (Phase 4) and deck PDF (Phase 6).
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
