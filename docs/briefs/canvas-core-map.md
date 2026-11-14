# The canvas core, mapped for Phase 6 (read from the code, Nov 13, 2026, at 6.0)

A reviewer's map of `src/ui/canvas` and its moodboard host, written so Phase 6's briefs can point at it. Check a
name against the code before relying on it: later milestones change the core.

Everything below is read from the code. Paths are relative to c:\Users\kevma\Documents\storiiboard.

### 1. Layers: generic core and moodboard host

**Generic core: `src/ui/canvas/`.** It knows no records. It takes `CanvasItem[]` (back to front), `CanvasLink[]`, the selection, the tool and the viewport. It reports finished gestures only.
- `types.ts`:
  - `Geometry {x,y,width,height,rotation}`: top-left before rotation, degrees clockwise round the centre.
  - `CanvasItem`: Geometry plus `id`, `label`, and optional `draw(ctx)`, `editable`, `openable`, `keepRatio`, `quick`, `section?: SectionLook{tab, drawTab}`.
  - `DrawContext {width,height,colours,zoom,inView,present?,print?}`.
  - `CanvasLink {id,label,from,to,route,startHead,endHead,color,width,text}`. `LinkEnd = {item,side|'auto'} | {x,y}`.
  - `Viewport {cx,cy,zoom}`.
  - `Tool` and `PlaceTool`: a closed union of `'select'|'hand'|'connector'|'rect'|'ellipse'|'triangle'|'diamond'|'text'|'sticky'|'link'|'section'|'page'`.
  - `CanvasCommand` (copy, cut, paste, duplicate, delete, forward, backward, front, back, align, distribute, tidy, sectionAround). `GeometryChange`, `ConnectDrop`.
  - The comment says world units are abstract.
- `Canvas.tsx` (`Canvas`, `CanvasProps`): the stage, pan and zoom (wheel, pinch, Space, Hand, arrows), selection, Shift-click, marquee, move, Konva `Transformer` handles (resize and rotate), Tab cycling, the context menu, the minimap toggle, the zoom buttons, quick-create "+" handles, connector draw and re-end, snap guides, and the in-place editor overlay (`renderEditor`).
  - Callbacks: `onGeometry`, `onNudge`, `onCreate(geometry, tool)`, `onEdit`, `onOpen`, `onPasteData`, `onSystemCopy`, `onCommand`, `onConnect`, `onQuickCreate`, `fixedColours`.
  - Culling: only items whose `boundsFor` meets `visibleWorld` are drawn, plus selected ones.
  - Exposes `data-items`, `data-selection`, `data-links`, `data-guides`, `data-zoom`, `data-cx`, `data-cy` for e2e.
- `viewport.ts`: `toWorld`, `toScreen`, `visibleWorld`, `zoomAround`, `panBy`, `centreOn`, `fitBounds(bounds,size,padding=48,maxZoom=1)`, `unionBounds`, `rectsMeet`, `MIN_ZOOM=0.1`, `MAX_ZOOM=8`, `DEFAULT_VIEWPORT {0,0,1}`.
- `hitTest.ts`: `boundsOf`, `boundsFor` (WeakMap cache), `hitsPoint`, `topmostAt`, `marqueeTouches`, `marqueeHolds`, `rectFromCorners`. Every hit area is the rotated box.
- `placement.ts`: `NUDGE=1`, `NUDGE_LONG=10`, `PASTE_OFFSET=16`, `MIN_SIZE=8`, `NEW_WIDTH/HEIGHT=200/120`, `PLACED_SIZE` per PlaceTool (page 1920×1080), `placedAt`, `pasted`, `tidy` (rounds to 2 decimals), `normalisedRotation`, `atLeastMinimum`.
- `snapping.ts`: `SNAP_PIXELS=6` (screen px), `snapRect`, `snapPoint`, `snapMove`, `mergeGuides`, `Guide`. It snaps only to other items' left/centre/right and top/middle/bottom lines. There is no grid snapping.
- `sections.ts`: `sectionContents`, `tabRect`, `sectionHit` (`EDGE_BAND_PIXELS=8`, screen px), `topmostSectionAt`, `drawOrder`.
- `zOrder.ts`: `reordered`, `sortKeysFor` (uses `keyBetween` from `src/core/ops/order`).
- `arrange.ts`: `alignItems`, `distributeItems`, `tidyItems`, `readingOrder`, `TIDY_GAP=24` (world).
- `routing.ts`: `routeBetween`, `snapEnd`, `pathHits`, `labelBox`, `headPoints`.
  - World units: `STAND_OFF=16`, `headSize = min(16, 8+3w)`.
  - Screen px: `SNAP_DISTANCE=12`, `PICK_DISTANCE=6`.
- `resolveLinks.ts` (`resolveLinks`, `anchorOf`, `RouteEntry`): connector ends follow live boxes.
- `LinkShapes.tsx` (`LinkShape`, `LABEL_FONT_SIZE=14` world). The line's `strokeWidth = link.width` is in world units and does scale with zoom; halo and end squares are /zoom.
- `ItemNodes.tsx` (memoised `ItemNodes`, `sameItems`) and `itemCache.ts` (`elementsFor`): the 5.7 element cache.
- `zoomSettle.ts` (`createZoomSettle`): items are redrawn for a new zoom 150 ms after a wheel stops.
- `Minimap.tsx`: `Minimap`, `minimapBounds`, 176×120. It takes `Geometry & {id}`.
- `ToolStrip.tsx`: hard-coded `TOOLS` plus `ShapesButton`, a `pages` flag for the Page tool, and `children` for host buttons.
- `keys.ts`: `toolForKey` (hard-coded letters), `commandForKey`, `zoomShortcut` (Shift+0/1/2), `zoomStepFor`, `quickSideFor`, `arrangeForKey`.
- Also: `CanvasMenu.tsx`, `pasteFallback.ts`, `useCanvasColours.ts` (`themeColours`, `useCanvasColours`), `PageStage.tsx` (read-only renderer).

**Undo wiring.** The canvas has none. Each callback becomes one `projectStore.getState().applyWith(records => ({changes}))`, which is one op group. ⌘Z is app-level.

**Moodboard host: `src/features/moodboards/`.**
- `BoardView.tsx`: wires the Canvas to the actions.
- `items.ts`: props, `canvasItems`, change builders.
- `drawing.tsx` (`withDrawing`): kind to drawing.
- `connectors.ts`, `connectorFields.ts`, `sections.ts` (host-side move, arrange and nudge), `boardActions.ts` (op groups), `moodboardStore.ts` (selection, viewport and tool per boardId, clipboard, editing).
- Also: `PropertiesStrip.tsx`, `TextEditor.tsx`, `PictureNode.tsx`, `pages.ts`, `pageFormats.ts`, `deckPrint.ts`, and the cards and fonts files.

**World-to-screen transform.**
- It lives in `viewport.ts`, at zoom = screen px per world unit, and in the Layer at `Canvas.tsx:1104` (`x = w/2 - cx*zoom`, `scale = zoom`).
- The same formula is duplicated at `Canvas.tsx:829` (menu key) and `Canvas.tsx:1235` (editor overlay). `BoardView.worldAt` uses `toWorld`.
- Strokes on items, the preview, guides and handles use `strokeScaleEnabled={false}` (screen px). `Transformer anchorSize=8` and `rotateAnchorOffset=24` are screen px.

**Pixel assumptions baked in as world units** (wrong if one unit = 1 m):
- `MIN_SIZE` 8. It is used in `atLeastMinimum`, `boundBoxFunc` (`MIN_SIZE*view.zoom`) and draw-drag minimums. `items.ts` `itemFields` also clamps width/height to at least 8.
- `NUDGE` 1/10, `PASTE_OFFSET` 16, `PLACED_SIZE` 200×120 and others, `TIDY_GAP` 24.
- `EDITING_NAME_WIDTH` 180, `STAND_OFF` 16, head sizes, `LABEL_FONT_SIZE` 14, connector width (default 1.5, clamped 0.5–24).
- On the host: `SECTION_PADDING` 40, `SECTION_TAB_HEIGHT` 24, `SECTION_NAME_SIZE` 16, `QUICK_GAP` 80, `DEFAULT_FONT_SIZE` 24, `cleanSize` 4–1000, `STICKY_PADDING` 12.
- Zoom: `MIN_ZOOM` 0.1 / `MAX_ZOOM` 8, `fitBounds` maxZoom 1 (a 5 m room fitted would be 5 px), reset zoom = 1, the "100%" label (`percent = zoom*100`).
- `tidy()` rounds to 0.01 units, which is 1 cm at 1 unit = 1 m.

**Option for the brief.** The host could convert metres to canvas units at its boundary (for example, 1 unit = 1 cm, ×100). Most of the constants above then land at sensible sizes and `tidy` gives 0.1 mm. The other route is making zoom limits, fit maxZoom, nudge, MIN_SIZE and so on into Canvas props.

### 2. Stored props
- **`board_item`** (docs/SBD_FORMAT.md "Boards (5.0)", lines 742–927; read by `items.ts` `itemFields`, written by `propsFor`):
  - Common: `kind`; `x`, `y`, `width`, `height` (world units; width/height at least 8, smaller reads as 8); `rotation` (degrees 0 to under 360, missing = 0; sections and pages always 0).
  - Shapes: `fill` and `stroke` (`#RRGGBB`, kept upper case).
  - Text, sticky and field_card: `text` (not on field_card), `font_family`, `font_weight` (100–900), `font_italic`, `font_size` (4–1000), `color`, `align`.
  - Link: `url`, `title`. Section and page: `name`. Section: `color` from 6 tints.
  - Live cards: `shot_id`, `scene_id`. Page: `format`, `orientation`, `background`. Field card: `field`.
  - Connector (`connectorFields.ts` `connectorFields`/`connectorProps`; it has no x/y/w/h): `from`, `to` (`{item,side}` or `{x,y}`), `route`, `start_head`, `end_head`, `color`, `width`, `label`.
  - Z order is the `sort_key` sibling order. There is no `z`, no `locked`, no `opacity` prop. An unknown kind is kept and not shown.
- **`board`** (`boards.ts` `boardFields`): `kind` (moodboard or deck), `department`, `name`, `page_format`, `page_orientation`, and links `scene_ids`, `character_ids`, `location_ids`.
- **`plan` / `plan_item` today: only the two names** in `RECORD_TYPES` (`src/core/model/record.ts:16-17`). No props, readers, SBD_FORMAT section, trash, history or tile code exist.
  - Decision 1: one `plan_item` per item, always in metres.
  - Decision 2: `plan.kind` is `room` (under the project, pointed to by a scene's `room_id`), `blocking` (under the scene) or `setup` (under the setup).
  - Decision 16: one schema version in 6.1, props only.
  - `setup` (6.0) is documented at SBD_FORMAT.md:591.

### 3. Kinds: no registry
- Kind dispatch is if-chains:
  - Drawing: `drawing.tsx` `withDrawing`, if-chain over `fields.kind` into `shape`, `words`, `picture`, `videoCard`, `linkCard`, `sectionBox`, `pageBox`, `fieldCard`, `drawLive`.
  - Flags: `items.ts` `canvasItems` sets `editable`, `openable`, `keepRatio`, `quick` and `section` per kind inline.
  - Kind list: `KINDS`/`ItemKind` and `KIND_LABEL` in `items.ts`.
  - Default sizes: `PLACED_SIZE` in the core, per PlaceTool.
- Hit area is always the rotated box.
- Adding a kind touches: the `ItemKind`/`KINDS` union, `itemFields` and `propsFor`, `KIND_LABEL` and i18n, `canvasItems` flags, a draw branch, `styleChanges` if styleable, `ToolStrip`'s `TOOLS` plus `toolForKey` plus `PlaceTool`/`PLACED_SIZE` in the core if it gets a tool, and `boardActions.placeItem`.
- **Properties strip** (`PropertiesStrip.tsx`):
  - It takes `fields: ItemFields[]` and calls `onChange(StylePatch)`, which becomes `changeStyle` and then `items.ts` `styleChanges` (one group; each kind takes what fits).
  - It shows the Arrange group for 2 or more items. It is a fixed 72 px band, with `children` for kind-specific panels: `CardProperties`, `LiveProperties`, `ConnectorProperties` (chosen in `BoardView` at about line 283).

### 4. Several parents on one canvas
- The **Canvas core takes a flat list** and assumes no parent. Selection is ids. Tab and ⌘A cycle all items.
- Single-parent assumptions are all on the host:
  - `itemsOf(records, boardId)`, `canvasItems(records, boardId)`, `connectorsOf` and `canvasLinks(…, boardId)`.
  - `createItems(records, boardId, …)` (key after `lastKey` of that parent).
  - `reorderChanges(records, boardId, …)` and `clipOf`/`pasteChanges(…, boardId…)`, so paste targets one parent.
  - `liveSelection` (filters `parentId === boardId`).
  - `moodboardStore.selections[boardId]` and `viewports[boardId]`.
  - `geometryChanges` and `styleChanges` require `type === 'board_item'`.
- Connectors: `connectors.ts` `liveItem` and `endOk` require the attached item's `parentId === boardId`. A connector cannot join items of two plans (for example, a blocking path to a room piece).
- `moveChanges` handles mixed parents (per `record.parentId`), but section contents only within one parent.
- Z order across three plans is whatever order the host concatenates. Reorder works only within one parent's siblings.
- Moving an item into another plan ("this setup only") is possible as a `move` op (`Change` has `parentId`).

### 5. Ops
- `Change` (`src/core/ops/ops.ts:38`) is one of `create`, `update {set, unset}`, `move {parentId, sortKey}`, `retype`, `trash`, `restore`.
- Helpers in `boardActions.ts`, each one `applyWith` group:
  - `placeItem`, `changeGeometry` (`sections.moveChanges`: section contents plus free connector ends), `nudge` (`nudgeMoveChanges`), `reorder`, `deleteSelection` (`trashItemsChanges`: items plus attached connectors in the same group), `cutSelection`, `pasteClipboard`, `duplicateSelection`.
  - `connect` (`connectChanges`), `changeConnector` (`connectorStyleChanges`), `quickCreate`, `arrangeSelection` (`arrangeChanges`), `sectionAroundSelection`, `changeStyle`, `finishEditing` (`textEditChanges`, `seedWithText`).
  - Pure builders live in `items.ts`, `connectors.ts` and `sections.ts`.
- Connectors follow live: attached ends are re-resolved on draw (`resolveLinks`). Moving or resizing an item writes nothing to its connectors. Only free ends inside a moved section are updated (`freeEndChanges`).
- Trash and restore:
  - Trashing items trashes their attached connectors with the same `trashed_at`/`trashed_by`.
  - `connectorsToRestore` and `trashedWithItem` bring them back. `trashBoardChanges`/`restoreBoardChanges` handle a board with its items.
  - Generic code knows `board_item` by name: `ops.ts:507` `TRASHED_BY_PEOPLE` (no `plan`/`plan_item`), `src/features/trash/trash.ts` (`TrashKind` `boardItem`, lines 116, 156, 323–331) and `src/features/history/summary.ts` (lines 393, 623, 673, 686–689, 809–902). `plan_item` needs the same treatment in all three.

### 6. Never themed
- `items.ts` sets `BOARD_COLOURS = {ink:'#16150F', paper:'#EEE9DF', raised:'#C9C1B1'}` (also `BOARD_MUTED`, `BOARD_WARNING`, `STICKY_*`, `SECTION_COLOURS`).
- `BoardView` passes `fixedColours={BOARD_COLOURS}` to `Canvas`. The Canvas then uses it for the world, item defaults, selection and handles, and sets the container's `background` and `outlineColor`. Without it, `useCanvasColours` reads the theme.
- Drawings fall back to `ctx.colours`. Stored colours are drawn as stored. Export passes `BOARD_COLOURS` too.
- A plan does the same by passing its own fixed set. Note `useCanvasColours`'s theme fallback for anything that forgets.

### 7. Export
- `src/features/export/deckRender.tsx`:
  - `renderPage(ScenePage)` mounts `PageStage` in a detached React root. `PageStage` takes `page: CanvasItem` as the clip box, `items`, `links`, `size`, `colours`, `print`, `pictureZoom`, and fits by `scale = min(size/page)`.
  - `RenderedPage.canvas(pixelRatio)` returns `stage.toCanvas` for PNG (`deckPng.ts` `writePagePngs`, 1x or 2x world size).
  - `print()` returns `snapshot(layer)`, then `deckDisplay.ts` `displayOps`, then `deckPdfWriter.ts` `writeDeckPdf` (pdf-lib, text as real fonts, `PRINT_KINDS` Group, Rect, Ellipse, Line, Path, Text, Image).
- Reusable: `PageStage` with a plan "page" item (it clips to any rectangle), snapshot, displayOps and the PDF writer.
- Deck-bound pieces:
  - `PrintPage.format: PageFormat` and `pdfPageSize` (16:9, 9:16, 4:5, a4, letter).
  - `scale = paperWidth / page.world width`, so a page always fills the paper width and is never to scale.
  - `fixedStroke` widths (`strokeScaleEnabled={false}`) are converted into page world units (`deckPdfWriter.ts:395`). With metres, 1.5 becomes 1.5 m.
  - PNG size = world size × pixelRatio, so a 10 m page is 10 px at 1x.
  - There is no legend or scale-bar code. `deckPrint.ts` `printPages` builds `ScenePage` from board records.

### 8. Performance test (`e2e/perf.spec.ts:283-699`)
- It runs only with `SB_PERF=1`, in Chromium, at a 1440×900 viewport. Test name: "a 500-item board with 150 pictures pans, zooms, drags and selects smoothly".
- Build:
  - 150 generated JPEGs come through the real drop path (5×30).
  - Then one `projectStore.apply` with `items.createItems`: 150 stickies, 100 shapes (some rotated 15°), 50 text boxes, 10 shot cards, 10 sections, plus 30 connectors (`connectors.createConnectors`).
  - Layout is a 25-column grid of 320×280 cells, shuffled. Modules are reached through `/src/…` dynamic imports. It expects `data-items` length 470 and all 150 `data-picture-levels`.
- Measured as requestAnimationFrame gaps:
  - Wheel pan 3 s with all in view, and at 100%.
  - Ctrl+wheel zoom from fit to 400% and back.
  - Drag of 20 selected items over 90 moves; marquee over about 200 items.
  - Reopen time and JS heap.
- Budgets: pan and zoom p95 < 34 ms; drag p95 < 50 ms; marquee picks > 150; reopen < 3000 ms; no page errors.
- 5.7's techniques:
  - Culling in `Canvas` (`drawn`, `awayFrom`). Memoised `ItemNodes` with `elementsFor`.
  - `drawZoom` settles 150 ms after the wheel.
  - `boundsFor` WeakMap. Link `routes` cache.
  - Snap targets limited to in-view items.
  - Pictures: `levelFor` (`src/core/media/decoded.ts`) uses the 640 px thumbnail until the long edge × zoom × dpr passes 640, then the stored ≤2560 px. A BoundedCache keeps about 64 full pictures. `PictureNode.tsx`.
- Decision 15 asks for 300 items in 6.11, measured the same way.

### 9. Plan icons
- Location: `src/ui/icons/plan/<group>/<name>.svg` plus `INDEX.md`. Loaded by `planIcons.ts` through `import.meta.glob('./*/*.svg', ?raw)`.
- Exports: `PLAN_ICON_GROUPS = ['camera','lighting','grip','set-art','cast','sound','production']`, `PlanIcon {id:'camera/dolly-track', group, label (from <title>), svg}`, `PLAN_ICONS` (sorted by group, then id), `planIconDataUrl`.
- Test: `planIcons.test.ts` checks 68 icons against INDEX.md.
- Only use today: `src/app/catalogue/Catalogue.tsx`. The comment in `planIcons.ts` still says "Phase 5 draws them".
- Counts: camera 10, lighting 12, grip 12, set-art 12, cast 6, sound 4, production 12 (68).
- Format: every SVG is `width=32 height=32 viewBox 0 0 32 32`, `stroke="#16150F"`, `stroke-width 1.5`. There is **no real-world size anywhere** (6.3 must add a size table).
- Fills are literal hex:
  - camera #1F2F4D, lighting #D9A23D, set-art #8FA38E, cast #E9B8A6, sound #A8482F.
  - **grip and production use oatmeal #C9C1B1 / ink / white**, not the DESIGN.md department colours (lighting+grip mustard; sound+production rust).
- Extra strokes: Signal Orange #E0612B (field-of-view, generator, snap-point, stairs) and Truffle #A35139 (first-aid, hazard).
- PLAN.md:2070 still says "Phase 6 recolours them … ink, oatmeal, white and orange become tokens", which conflicts with decision 13 (never themed). Settle it in a brief.
- DESIGN.md:257-261 "Bird's-eye plan":
  - Selected camera: accent outline and a field-of-view cone in the accent at 10%.
  - Lights: mustard cones.
  - States: hover dashed, selected accent box with handles, locked layer at 45% opacity, ghost from another setup dashed.
  - DESIGN.md elsewhere says selection is an ink fill and the canvas's handles are ink. Reconcile.

### 10. What will bite
- **No `locked`, non-pickable or dimmed item in the core.** `topmostAt`, marquee, Tab and ⌘A pick everything. Decision 10 (lock and dim layers) and decision 12 (locked underlay) need a core flag, for example `CanvasItem.locked` or `listening`, plus dimming in draw.
- **Closed tool set.** `Tool`, `PlaceTool`, `PLACED_SIZE`, `ToolStrip.TOOLS` and `toolForKey` letters are hard-coded. Plan tools (wall point-to-point, measure, place icon) need the core opened up, for example host-supplied tools. Letters V, H, R, T, S, O, L, C, P and Shift+S are taken.
- **Rectangles only.** Hit area and bounds are the rotated box. A wall drawn point to point needs to map to a rotated rect or a connector-like path. A FOV or beam cone outside the box is neither hit nor culled correctly: culling uses item bounds, so a cone of an off-screen camera vanishes.
- The world-unit constants and zoom limits listed in section 1. Connector width and label font are in world units.
- Grid, rulers and scale bar are absent: the snapping only knows item lines. The zoom label is a percentage.
- Export is not to scale (section 7). `pdfPageSize` knows only deck formats.
- Host code is keyed by `board_item` and `boardId` throughout. Reuse means generalising `items.ts`, `connectors.ts`, `sections.ts` and `boardActions.ts` over (record type, parent ids), or writing a plan host.
- Connectors cannot cross parents (decision 9 builds cast paths on connectors, and positions may sit in different plans).
- `sceneApprovals.ts:158` has a comment saying a lens that comes from a setup or the plan must count for approvals. Watch the Nov 9 "no Changed since approval after an upgrade" rule in 6.1 and 6.4.
- `DrawContext.present` and `print` are never passed by `ItemNodes`, only by `PageStage`.
- Tiny text: at 1 unit = 1 m, font sizes like 0.25 under a large Layer scale. Rendering quality and `cleanSize`'s floor of 4 are untested. Probe it in WebKit too.
- Setup workspace tiles: `src/app/shell/workspaces.ts:121-141` has `setups`, `layers`, `plan`, `selection`, `frames`, `library`. Only `setups` is mapped in `src/app/shell/tileContent.tsx` `TILE_CONTENT` (`SetupsTile`). Placeholder words are in `src/core/i18n/locales/en.ts:266-275` (and es.ts).
- `src/features/birdseye` today holds only `SetupsTile.tsx` and `useSetupDrag.ts`.
- HANDOFF.md and PLAN.md record no canvas-core lows deferred to Phase 6. The only related open items are Kevin's Phase 5 gate checks (performance on his Mac and a Windows laptop; Windows Pages-panel drag B1 in docs/DESKTOP_GAPS.md).

Key files: src/ui/canvas/Canvas.tsx, src/ui/canvas/types.ts, src/ui/canvas/viewport.ts, src/ui/canvas/placement.ts, src/features/moodboards/BoardView.tsx, src/features/moodboards/items.ts, src/features/moodboards/drawing.tsx, src/features/moodboards/boardActions.ts, src/features/moodboards/connectors.ts, src/features/moodboards/sections.ts, src/features/export/deckRender.tsx, src/features/export/deckPdfWriter.ts, src/ui/icons/plan/planIcons.ts, e2e/perf.spec.ts, docs/SBD_FORMAT.md, docs/PHASE6_DECISIONS.md.
