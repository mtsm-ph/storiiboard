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
- **Accent: Signal Orange #E0612B.** Use it only for:
  - the active workspace
  - the selected frame
  - the playhead
  - primary buttons
  - the active scene marker

  Text on orange is always ink. Never use orange as a large fill inside the app.
- **Supporting colours:**
  - Truffle #A35139 for warnings and conflicts, with paper text.
  - Burning Flame #FFB162 for golden hour and highlights, with ink text.
- **Department tags** are labels only, never state:
  - Camera: navy #1F2F4D
  - Lighting and grip: mustard #D9A23D
  - Art: sage #8FA38E
  - Wardrobe, HMU and cast: blush #E9B8A6
  - Sound and production: rust #A8482F
- **Selection:** toggles and segmented controls show their selected option as an ink fill, not orange.
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

## Tiles (the docking system)
- **Anatomy:**
  - 1.5px ink border, no radius, no shadow.
  - 26px title bar: grip, "NN / Title" mono label, tabs (the open tab on Oatmeal), maximize, close.
  - 8px gap between tiles, 44px top bar, 24px status bar.
- **Drag:** the tile lifts as a dashed ghost with a hard ink offset. The tile under the cursor shows five zones: four edges split, the centre adds a tab. The live zone turns orange and previews the split line. Escape cancels. Alt floats the tile.
- **Snap:** tiles snap within 8px and a dashed guide line shows. Hold Cmd to place freely.
- **Splitter:** dragging it resizes both neighbours, with live widths in mono. Double-click evens them out.
- **Maximize:** backtick (`) fills the app; the other tiles fold into chips along the bottom. Restore returns every tile to its exact size and position.
- **Reflow:** a new tile takes space from the neighbour on the split it was dropped on. A closed tile gives its space to the neighbour that shared its longest edge. Cmd+Z undoes.
- **Workspaces:** Storyboard, Production, Bird's-eye, Call sheet (Alt+1 to 4). A dot marks unsaved layout changes.

## Bird's-eye plan
- **Icons:** 68 top-down icons on a 32px grid with a 1.5px ink stroke, filled with the department colour (see `05_Plan_Icons/INDEX.md`).
- **Selected camera:** orange outline, and its field-of-view cone in orange at 10% fill. Field of view = 2 x atan(sensor width / (2 x focal length)).
- **Lights:** mustard beam cones.
- **States:** default, hover (dashed box), selected (orange box with handles), rotate, locked layer (45% opacity), ghost from another setup (dashed).

## Website
- **Layout:** a page that resizes, max width 1440px, with 16 to 48px side gutters. Grids collapse to one column on phones. Light and dark modes, with a toggle in the nav.
- **Hero:** "PLAN THE SHOT.", then an orange block framing a still with a face, then "SHOOT THE PLAN.", then "Built by a DP. Free and open source.", then the Mac and Windows downloads.

## Web companion (phone)
- **Size:** 390 x 844, light and dark.
- **Touch:** targets at least 44px.
- **Device chrome:** no fake status bar.
