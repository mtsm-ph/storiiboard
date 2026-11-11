# Phase 5 decisions (asked Nov 10, 2026; waiting for Kevin)

One page. Each decision: the question, what was weighed, the recommendation and why, and how hard it is to change
later. The plan is in `docs/PLAN.md`, "Phase 5 milestones"; the scope is "Phase 5 notes" there (Kevin, Nov 5). Nothing
is built until Kevin answers.

| # | Question | Weighed | Recommendation | Change later |
|---|---|---|---|---|
| 1 | How is a canvas stored? | One JSON blob per board (simple, fast to load) or one `board_item` record per item (already in the schema's record types). | **A record per item**, `board_item` under its `board`, geometry in props (x, y, width, height, rotation, z order). Every move is an op, so undo, History, Trash, suggestions and the MCP work as they do everywhere else. Several items moved at once are one op group. | Hard: it's the file format. |
| 2 | How many canvases? | One infinite canvas per project, or many boards. | **Many boards.** The Moodboard section lists them: one per department to start (CLAUDE.md: "Moodboards: one per department"), more by +; a deck is a board too (decision 3). Each links to scenes, characters and locations. | Medium. |
| 3 | What is a deck? | A separate deck record with slides, or pages drawn as frames on a board, as Figma does. | **Frames on a board.** A deck board's page frames (16:9, or A4/Letter for a treatment) are ordered; Present shows them one by one; Export makes one PDF page per frame. Items can sit beside the pages as working space, never printed. | Medium. |
| 4 | Pictures on the canvas | Keep originals, or store a copy sized for the canvas. | **As frames' pictures are today** (`media_files` by SHA-256, inside the .sbd), with a smaller copy for drawing when an image is over 4096 px, so a board of 200 pictures stays quick. The original is kept for export. | Easy. |
| 5 | Video on the canvas | Play inline, or a card with its poster that opens the Player. | **A card with a still**, opening the Player tile (Phase 2's copies); no playback on the canvas. | Easy. |
| 6 | Live linked cards (shots, scenes) | Copy the frame's picture and specs onto the board, or read them live. | **Live** (CLAUDE.md: views never copy data): a card shows the shot as it is now, in the Trash it reads as such, and clicking it jumps to the board's frame. | Hard once boards rely on copies. |
| 7 | Text and fonts on boards | Bundled fonts only (Inter Tight, JetBrains Mono), or also fonts installed on this computer. | **Bundled plus this computer's fonts**, listed through Rust; a board that uses a font another computer lacks shows it in a fallback and says which. Decks for clients need brand fonts. (Needs a crate to list fonts: font-kit, MIT/Apache; Kevin's yes.) | Medium. |
| 8 | Deck templates | None, a few film-native ones, or many. | **Four to start, film-native:** Treatment, Lookbook, Pitch, Shot list. Each is a board of page frames whose cards fill from the project (title, logline, scenes, frames, palettes, people). | Easy to add more. |
| 9 | Scene palettes from a moodboard, and swatches | Work out palettes on the device; export swatches as PNG strip and Adobe .ase. | **On the device** (the existing palette code, k-means on the board's pictures); **.ase written by our own code** (a small, documented binary format), no dependency. | Easy. |
| 10 | Connectors, sections, tidy up, snap guides | All in the first milestone, or in steps. | **In steps** (plan below): the canvas first, then items, then connectors and sections, then layout tools. | n/a |
| 11 | Shared with Phase 6 (bird's-eye) | A canvas just for boards, or a canvas core both use. | **One canvas core** (pan, zoom, selection, transforms, snapping, undo, minimap) with real-world units as an option, so Phase 6 builds its plans on it. | Hard. |
| 12 | Performance target | — | **A board of 500 items, 150 of them pictures, pans and zooms at 60 fps** on Kevin's Mac and a mid Windows laptop; tested with a generated board, as Q2 tested a 1000-frame storyboard. | Easy. |
| 13 | Comments and web on boards | Now, or with the web companion. | **Phase 9.** Boards are desktop only in Phase 5; the review copy shows them later. | n/a |

Also for Kevin: the gate stays "a deck built in under an hour" (on a real pitch).
