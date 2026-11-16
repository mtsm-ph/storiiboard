# Canvas tool icons

One SVG per tool of the canvas's tool strip (src/ui/canvas/ToolStrip.tsx), on plans and boards alike. Each is drawn on
a 32 × 32 grid with a 1.5 px stroke in `currentColor`, so the strip can draw it in ink, or in the inverse colour on the
pressed tool's ink fill. A fill stays only where the kit's drawing has one (its department colour), and words on such a
fill keep the kit's ink.

"kit" means a copy of the drawing in Kevin's design kit (src/ui/icons/plan, never edited from here), with its ink made
`currentColor` and its `<title>` left out (the button's own name is what people hear; a title would add a second
tooltip). "drawn here" means drawn for the strip in the kit's style.

| File | Tool | Source |
|---|---|---|
| select.svg | Select (both) | drawn here |
| hand.svg | Hand (both) | drawn here |
| wall.svg | Wall (plan) | kit: set-art/wall.svg |
| door.svg | Door (plan) | kit: set-art/door.svg |
| window.svg | Window (plan) | kit: set-art/window.svg |
| camera.svg | Camera (plan) | kit: camera/camera.svg |
| light.svg | Light (plan) | kit: lighting/fresnel.svg |
| mark.svg | Mark (plan: places a tape mark) | kit: cast/tape-mark.svg |
| measure.svg | Measure (plan) | kit: production/measure.svg |
| rect.svg | Rectangle (board) | drawn here |
| text.svg | Text (board) | drawn here |
| sticky.svg | Sticky (board) | drawn here |
| link.svg | Link (board) | drawn here |
| connector.svg | Connector (board) | drawn here |
| section.svg | Section (board) | drawn here |
| shapes.svg | Shapes (board: opens the four shapes) | drawn here |
| ellipse.svg | Ellipse (board, under Shapes) | drawn here |
| triangle.svg | Triangle (board, under Shapes) | drawn here |
| diamond.svg | Diamond (board, under Shapes) | drawn here |
| page.svg | Page (a deck's board) | drawn here |

A file is named for its tool: a plan's tool id without its `host:` prefix (`host:wall` is wall.svg), a board's as it
is (`rect` is rect.svg).

## Replacing one

Save your drawing over the file with the same name: a `viewBox="0 0 32 32"`, strokes in `currentColor` (so the
pressed tool turns inverse), no `<title>`. It is read when the app is built (`toolIcons.ts` bundles every SVG in this
folder), so nothing else changes. A new file needs a tool of that name to show; `toolIcons.test.ts` checks every tool
has its file.
