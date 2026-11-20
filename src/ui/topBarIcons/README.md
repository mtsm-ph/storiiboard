# Top bar icons

One SVG per icon of the top bar (src/app/shell/TopBar.tsx), drawn for the bar in the style of the canvas's tool icons
(src/ui/canvas/toolIcons). Each is on a 32 × 32 grid with a 1.5 px stroke in `currentColor`, so the bar draws it in
ink on paper, in paper in Dark, and muted when its button has nothing to do. Every shape carries
`vector-effect="non-scaling-stroke"`: the bar draws an icon at 20 px, and without it the stroke would shrink to under
1 px, thinner than the History button's glyph beside it (1.5 px, src/ui/glyphs.tsx).

| File | Button | Source |
|---|---|---|
| undo.svg | Undo (src/app/shell/UndoRedoButtons.tsx) | drawn here |
| redo.svg | Redo (src/app/shell/UndoRedoButtons.tsx) | drawn here |

## Replacing one

Save your drawing over the file with the same name: a `viewBox="0 0 32 32"`, strokes in `currentColor` with
`stroke-width="1.5"` and `vector-effect="non-scaling-stroke"` on every shape, no `<title>` (the button's own name is
what people hear; a title would add a second tooltip). It is read when the app is built (`topBarIcons.ts` bundles every
SVG in this folder), so nothing else changes. A new icon is added to `TOP_BAR_ICON_NAMES` there and to this table;
`topBarIcons.test.ts` checks every icon the bar uses has its file, and that no file is left unused.
