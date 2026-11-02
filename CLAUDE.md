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
- /prototype is visual reference only. Match its look; never import from it.

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
- Tests: Vitest (unit), Playwright (end to end).
- CI: GitHub Actions builds Mac and Windows installers on every PR.

## Repo layout
- src/app: screens and routing.
- src/features/<tool>: storyboard, video, birdseye, locations, people, gear, schedule, callsheets, moodboards, decks, cloud, availability, suggestions.
- src/core/model: record types and schema.
- src/core/ops: operations, undo, history.
- src/core/storage: .sbd read and write. The only code that touches the disk.
- src/core/net: weather, geocoding, maps, cloud links.
- src/core/checks: consistency checks shared by the app and MCP.
- src/ui: shared components.
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
- .sbdpack = zip of the .sbd plus all linked media ("Collect project").
- Document every schema change in docs/SBD_FORMAT.md.
- JSON and CSV export must always round-trip without data loss.

## Data model
- Every record has: id, type, props, parent_id, ordered children.
- Changing a record's type never drops its props.
- Records: project, scene, shot, setup, media, location, person, department, gear_item, shoot_day, callsheet, plan, plan_item, board, board_item, design, comment, suggestion, availability.
- A shot links to: one scene, at most one location, shoot_day and setup, and many people, gear items and media.
- Views (storyboard, shot list, schedule, call sheet, deck) read records. They never copy data.
- Rollups (day totals, a location's shot list) are computed, never stored.
- Users can add custom props to shots, locations and people.

## Edits, undo and autosave
- Every change is an operation: id, record_id, kind, before, after, author, timestamp.
- The UI, MCP, imports and web suggestions all apply edits through src/core/ops.
- Undo and redo walk the op log. Every canvas action is undoable.
- Each op commits to SQLite in a transaction right away. There is no Save button.
- Users can name versions; automatic snapshots are pruned after 30 days.

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
- The desktop app publishes a snapshot. The web never edits the .sbd directly.
- Suggestions and comments sync back to the desktop approval queue.
- Access by per-person invite link (magic link). No public projects.
- Contact details are visible only to people on that call sheet.
- Supabase row-level security on every table, with tests for each policy.
- Company workspaces: roles owner, approver (CEO, marketing), creator, crew, editor, cast, client.
- Published snapshots expire 30 days after the last shoot day by default.

## MCP server
- Transports: stdio for Claude Desktop and Claude Code; local HTTP bound to 127.0.0.1 with an Origin check and a token.
- Read tools: project summary, scenes, shots, schedule, call sheets, people, gear, locations, plans, suggestions.
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
- Dark charcoal base; pastel accents: dusty rose, sage, lavender, warm sand.
- DM Sans for UI, Playfair Display for display type.
- Dense, quiet UI like Linear. The storyboard images supply the color.

## Workflow
- Start each phase in plan mode and wait for Kevin's approval.
- One PR per milestone, small enough to review in 15 minutes.
- Every PR adds or updates tests for the flow it touches.
- Before saying done: `npm run lint && npm test && npm run e2e`.
- Ask before adding a dependency or changing the .sbd schema or the MCP tools.
- Update the status in docs/PLAN.md at the end of each PR.
