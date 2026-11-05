# Storiiboard design spec

The rules behind every screen. Values live in `03_Tokens`.

## Feel
A technical film poster printed on paper. Boxed tiles with 1.5px ink rules, tiny uppercase mono labels, gauges, bold type. Orange is rare. Modern and fast to use.

## Logo
- **Wordmark.** STORIIBOARD in Inter Tight 900, all caps. The two I's are orange bars, each with a round orange dot above. Use it wherever the name needs to be read: website, splash screen, call-sheet header, deck covers.
- **S mark.** A heavy monoline S. Its two terminals are orange ball terminals: the dots from the wordmark, now part of the letter. A thin inline runs through the S from dot to dot and threads into a ring inside each dot.
  - Story: two reels with film running between them, or a camera move from first mark to last.
  - Look: 70s inline lettering, which gives the retro feel.
- **Variants:**
  - **Mark on paper.** The inline is paper-coloured.
  - **Mark on dark.** Paper S on Abyssal, with an Abyssal inline.
  - **Poster.** The mark with an orange offset shadow, like a misregistered print. Website and print only.
  - **Small.** At 32px and below, drop the inline and the rings: a solid S with solid dots.
  - **App icon.** Paper S on an ink rounded square (22.3% corner radius). Use the small version at 48px and under.
- **The S stands alone.** Use it for icons, favicons, the app top bar, avatars and stickers, always centred in its square. Never place it next to or inside the wordmark; the wordmark carries the name on its own.
- **Never:** recolour the dots, rotate the mark, stretch it, or put the full mark (with the inline) below 32px.
- The inline colour always matches the background behind the mark.

## Colour
- **Light theme:**
  - Paper #EEE9DF with grain for backgrounds
  - Oatmeal #C9C1B1 for wells and selected rows
  - Ink #16150F for text and rules
  - Muted #5E5A52 for secondary text
- **Dark theme:**
  - Abyssal #1B2632 for backgrounds
  - Blue Fantastic #2C3B4D for panels
  - Paper #EEE9DF for text
  - Muted #A9B2BC for secondary text
  - Darker abyssal #0E151C for tile outlines. The top bar and website nav keep the paper outline so the active tab reads clearly.
- **Accent: #DF5E27** in the default theme. It is Signal Orange darkened a touch so marks on paper reach AA's 3:1
  (3.01:1; ink on it is 5.0:1). Use it only for:
  - the active workspace (the active sidebar section)
  - the selected frame
  - the playhead
  - primary buttons
  - the active scene marker

  Text on the accent is always ink. Never use it as a large fill inside the app, and always pair it with a second cue.
- **Brand: Signal Orange #E0612B**, a fixed token for the logo's dots and bars only. It never follows a project theme.
- **Project themes:** a project can take its colours from its logo or key image. The accent and the surfaces change;
  type, rules, grain, layout, the logo, warning, golden hour and the department colours don't. Opening another project,
  or switching light and dark, eases every colour over 200ms (instant with reduced motion). The status bar's Theme
  switch reads Project, System, Light, Dark: Project, the default, follows the open project's own mode, and the OS
  while none is open.
- **Tokens in code** (src/ui/theme.css):
  - **Semantic, set by a project theme:** `bg`, `surface`, `surface-raised`, `border`, `border-top`, `text`, `text-muted`, `text-inverse`, `accent`, `accent-contrast`. Classes read `bg-surface`, `text-text-muted`, `border-border`.
  - **Fixed, the same in every project:** `brand`, `warning`, `highlight`, the `dept-*` tags, and `paper-fixed` and `ink-fixed` for text on tags and chips.
  - **The default theme** reads the kit's variables (paper, panel, oatmeal, rule, ink, muted), so the names above map to the colours listed here.
- **Supporting colours:**
  - Truffle #A35139 for warnings and conflicts, with paper text.
  - Burning Flame #FFB162 for golden hour and highlights, with ink text.
- **Department tags** are labels only, never state:
  - Camera: navy #1F2F4D
  - Lighting and grip: mustard #D9A23D
  - Art: sage #8FA38E
  - Wardrobe, HMU and cast: blush #E9B8A6
  - Sound and production: rust #A8482F
- **Selection:** toggles and segmented controls show their selected option as an ink fill, not the accent.
- **Shot status uses shape, not colour:**
  - Have: filled square
  - Need to shoot: empty square
  - Source: half-filled square

## Type (all SIL Open Font License)
- **App:**
  - Inter Tight for the UI. Display 32/800, heading 18/700, body 14/400, UI 13/600.
  - JetBrains Mono for every technical value: lens mm, T-stop, shot and scene numbers, times, timecode.
  - Labels are 10px mono, uppercase, with 0.08em tracking.
- **Website adds:**
  - Archivo 900 at width 125 for giant headlines
  - Jost 800 (Futura-style) for section heads
  - Outfit 600/800 (rounded geometric) for feature titles
  - Bodoni Moda italic for editorial lines
  - Mono overlays of timecodes and coordinates

## Navigation
- **Top bar (44px):** the S mark, the project name, and at the right the Layout menu and the project menu (History,
  Watermark Settings, Export Project, Archive Project). Like the sidebar, it keeps the paper outline in dark.
- **Sidebar (248px, left, between the top bar and the status bar):**
  - The project switcher at the top: a dot in the project's accent, then its name. It opens recent projects, All
    projects… and New project….
  - Then one section per workspace, in this order: Storyboard, Assets, Team, Setup, Production, Moodboard, Settings.
  - Storyboard expands to its scenes, "SC 04  Scene Name" with the number in JetBrains Mono, ending with "+ Add Scene".
    Setup expands to its setups by scene.
  - Production holds the schedule, calendar, call sheets, locations, gear, and cast and crew.
- **States:** the active section is an accent fill with bold ink text. The active scene has an accent marker and a
  bold name. Sections not built yet are muted and show their phase.
- **Keyboard:** arrow keys move through the sidebar, Enter opens, Alt+1 to 7 jump to a section.
- **Hide sidebar:** a button at the sidebar's foot, bottom left, and ⌘\ (Ctrl+\ on Windows) fold it to a 36px strip
  at the window's left edge; Show sidebar sits in the strip's same corner. The workspace takes the room, each tile
  keeping its share. The choice is the person's and is remembered.
- **Projects screen:** one tile with New project… (primary), Open…, Open backup… and a Recent or Archived list: an
  accent dot, the bold name, the path in mono, the state and when it was last opened. The open project is marked
  Open. It shows when nothing is open, and from the switcher's All projects….
- **Archived project:** an ink-outlined banner above the workspace with Unarchive; the project leaves the switcher.

## Tiles (the docking system)
- **Anatomy:**
  - 1.5px ink border, no radius, no shadow.
  - 26px title bar: grip, "NN / Title" mono label, tabs (the open tab on Oatmeal), maximize, close.
  - 8px gap between tiles, 44px top bar, 24px status bar.
- **Drag:** the tile lifts as a dashed ghost with a hard ink offset. The tile under the cursor shows five zones: four edges split, the centre adds a tab. The live zone turns to the accent and previews the split line. Escape cancels. There are no floating windows (decided Nov 2).
- **Snap:** tiles snap within 8px and a dashed guide line shows. Hold Cmd to place freely.
- **Splitter:** dragging it resizes both neighbours, with live widths in mono. Double-click evens them out.
- **Maximize:** backtick (`) fills the app; the other tiles fold into chips along the bottom. Restore returns every tile to its exact size and position.
- **Reflow:** a new tile takes space from the neighbour on the split it was dropped on. A closed tile gives its space to the neighbour that shared its longest edge. Layout menu → Undo layout change takes back this workspace's layout changes for the session; Cmd+Z undoes project edits only.
- **Workspaces:** one per sidebar section: Storyboard, Assets, Team, Setup, Production, Moodboard, Settings (Alt+1 to
  7). A dot marks unsaved layout changes.

## Storyboard
- **Scenes tile:** each scene as number (mono, bold), heading ("INT. PENN STATION — DAY" once INT/EXT or DAY/NIGHT is
  set) and "1 3/8 pg · 6 fr · 67%" in mono ("done" at 100%). The active scene has the orange marker and a bold heading,
  as in the sidebar. A padlock per scene locks its shot numbers: open or closed, never faded.
- **Grid:** frames by scene group, each group headed "SC 04  Heading  1 3/8 pg · 4 have · 1 need". Cards are 176px
  and up, filling the row, with the picture at the project's aspect ratio and a strip below: the shot number in bold
  mono, the spec ("MCU · 35MM · T2.0") in mono, and the status shape at the right. Each group ends with a dashed
  "+ Frame" card the height of its neighbours.
- **Pictures:** a frame's picture fills it at the project's aspect ratio, cropped on its long side until it's framed in
  the inspector. Drop pictures on a frame to set its picture, or on a scene (or its + Frame card) for new frames; while
  a drag is over it, the frame or scene shows a dashed ink box and says what the drop will do. ⌘V pastes into the
  selected frame; "+ Pictures…" in the tile's header adds a frame per picture. A missing picture says "Picture
  missing" in the warning colour (paper text in dark mode, where Truffle falls below AA).
- **Notes and moves:** a note sits among the frames as a dashed ink card headed "Note", taking no number; Enter (or a
  double click) writes in it, ⌘Enter or leaving saves, Escape leaves it as it was. Frames and notes drag to a new
  place, across scenes too: the item lifts as a dashed ghost with a hard ink offset, like a tile, and a 3.5px ink bar
  shows where it will land; Escape cancels. "/" on the board opens the insert menu under the item: Frame, Scene,
  Note, Location…, narrowed as you type; the choice under the keys is the ink-filled row.
- **Sketching:** S on a frame, or Sketch in the inspector, opens the frame large over its picture in a modal dialog:
  Tool (Pen, Arrow, Box, Eraser; P, A, B, E), Line (Thin, Medium, Bold), Undo, Redo, Clear and Done, all in the
  inspector's control style. Strokes are drawn in the text colour, so on cards they read in light and dark; a frame
  with a sketch and no picture drops its "No image".
- **Selected frame:** a 3px accent outline, with the shot number on an ink chip as the second cue. Focus keeps its ink
  ring outside it.
- **Keyboard:** the board is one Tab stop. Arrows move through frames, notes and + Frame cards across scenes; Home and
  End go to the ends; Delete sends a frame or a note to the Trash; ⌘ (Ctrl on Windows) with an arrow moves it one
  place, crossing into the next scene at either end; "/" opens the insert menu. A frame stays in a scene whose
  numbers are locked.

- **Views:** Grid, Strip and Shot list, switched in the tile's header; the choice is the person's and is remembered.
  The strip is one row through the whole board, cards at a fixed height. The shot list is a table, one row per shot
  under a heading row per scene, with columns Shot, Size, Lens, T-stop, Support, Height, Move, Status, Action,
  Departments; the selected row takes the selected-row fill with the accent marker at its left edge and the ink chip
  on its number, and its cells go ink (muted text never sits on oatmeal). The board's keys work in every view.
- **Frame inspector:** the shot number large in mono over "SC 04 · INT. PENN STATION — DAY", then sections under
  10px labels: Picture (the frame-shaped framing well: drag, or arrows, + and −, 0; a Zoom slider with its percentage
  in mono; Centre; the file's name and path in mono; Choose picture… or Replace…, and Remove), Camera (size as a
  segmented control, lens mm, T-stop in thirds, support, height, move), Status (Have, Need, Source), Story (action,
  dialogue), Departments (tags in their colours when on, dashed outlines when off), then the scene (number, name,
  INT/EXT, time, length) and the links still to come with their phase. Typed fields save when left or on Enter;
  pickers save on change; the framing saves when it's let go. Enter on a frame goes to the inspector; Escape comes
  back.

## Bird's-eye plan
- **Icons:** 68 top-down icons on a 32px grid with a 1.5px ink stroke, filled with the department colour (see `05_Plan_Icons/INDEX.md`).
- **Selected camera:** accent outline, and its field-of-view cone in the accent at 10% fill. Field of view = 2 x atan(sensor width / (2 x focal length)).
- **Lights:** mustard beam cones.
- **States:** default, hover (dashed box), selected (accent box with handles), rotate, locked layer (45% opacity), ghost from another setup (dashed).

## Website
- **Layout:** a page that resizes, max width 1440px, with 16 to 48px side gutters. Grids collapse to one column on phones. Light and dark modes, with a toggle in the nav.
- **Hero:** "PLAN THE SHOT.", then an orange block framing a still with a face, then "SHOOT THE PLAN.", then "Built by a DP. Free and open source.", then the Mac and Windows downloads.

## Web companion (phone)
- **Size:** 390 x 844, light and dark.
- **Touch:** targets at least 44px.
- **Device chrome:** no fake status bar.
