# Controls clear of an overlay scroll bar; "This picture is no longer in the project." (6.27o): brief

Kevin, Nov 18, 19 and 20. Two small changes, both decided. The first changes screenshots, so its baselines are
regenerated afterwards (the main session does that part: `checkpoint/baselines-nov20`).

## Change 1: controls clear of an overlay scroll bar

Kevin (Nov 19): "fix the app. A button under an overlay scroll bar is hard to hit for a person too." "Keep controls
clear of the scroll bar wherever it lies over the content, in every scrolling tile. Decide by whether it overlays,
not by the system's name."

Where it came from: WebKit on the Mac, `e2e/planLayers.spec.ts`, "hides, locks, dims and solos layers…". The Layers
tile overflows, the Mac's overlay bar is drawn over the right edge of the tile's body, and the click on Solo (the
row's last control) went to the bar: the button's `aria-pressed` stayed `false`. The fix is in the app. That spec is
not touched.

### What is there today

- Every docked tile's body is one element, `src/ui/Tile.tsx` (the `data-scroll-root` div, `min-h-0 flex-1
  overflow-auto`). It is a block, so most tiles' own `overflow-auto` roots never scroll: the body does.
- 38 places in `src` set `overflow-auto`, `overflow-y-auto` or `overflow-x-auto`: 28 in tiles and panels, 10 in
  windows, dialogs and menus. A few really scroll by themselves (PlayerView's `h-full` root, SetupsTile's `max-h`
  list, the Storyboard strip and the shot list table sideways, PropertiesStrip sideways).
- No scroll bar is styled anywhere but PropertiesStrip's `[scrollbar-width:thin]`. `scrollbar-gutter` does nothing
  for overlay bars.

### Decisions

- **Whether bars overlay is measured, never read from the system's name.** A hidden box with `overflow: scroll`: when
  its `offsetWidth - clientWidth` is 0, bars take no room of their own, so they lie over content. The answer goes on
  `<html>` as `data-scrollbars="overlay"` (absent otherwise). It is measured when the app starts and again when the
  window gets focus or is resized (macOS can switch styles while the app runs: a mouse plugged in, the "Show scroll
  bars" setting). No timer.
  - Playwright's headless Chromium hides scroll bars, so it measures 0 too and reads as overlay. That is fine: the
    rule is about room, and there the bar has none.
  - With classic bars (Windows, a Mac set to always show them) nothing changes at all: the bar already has its own
    room.
- **A lane only where a bar can be: on a scroller that overflows.** Every tile's body always padded would put a
  strip beside every plan, board and Player. So a scroller gets a lane on the side its bar is on only while its
  content overflows that way:
  - overflowing up and down: `padding-inline-end` of 16 px;
  - overflowing sideways: `padding-bottom` of 16 px.
  The lane is the bar's own room, as a classic bar takes it.
- **One hook, used by every scroller that can really scroll:** `useScrollLane(ref)` in `src/ui` (with the probe).
  It watches the scroller's box and its content (a `ResizeObserver` on the scroller and its children, kept in step
  with a `MutationObserver` on the child list) and sets `data-scroll-lane="y"`, `"x"` or `"both"` on the scroller
  while it overflows and bars overlay; the padding is CSS in `src/ui/theme.css`, keyed on that attribute, through a
  token for the 16 px. A scroller that never overflows gets nothing, so nested ones never add up.
  - Put it on the Tile body and on every other element among the 28 in tiles and panels and the 10 in windows,
    dialogs and menus that sets an `overflow-*` class, except text areas. One line each; where a component is a
    plain function with no ref yet, give it one.
- **No flicker.** A lane narrows the content, which can change its height. If taking the lane away makes the
  scroller overflow again while its own box has not changed, the lane goes back on and stays until the scroller's box
  changes. Keep that rule a pure function with its own tests.
- No words change. No setting. Nothing stored.

### Tests

- Vitest: the rule's function (overflow on each axis, overlay on and off, the stay-on rule), and the probe's
  reading from the two widths.
- End to end, in a spec of its own (`e2e/scrollLane.spec.ts`), Chromium here:
  - in a tile made to overflow (the Layers tile in a small viewport, or as planLayers.spec sets it up), the last
    control of a row ends at least 16 px inside the scroller's right edge;
  - a tile that doesn't overflow has no lane (its content's right edge is where it is today);
  - with the root's attribute taken off by the test (classic bars), the overflowing tile has no lane.
- `e2e/planLayers.spec.ts` passes as it is.
- Screenshots: `e2e/visual.spec.ts` will fail here on the board and settings pictures, where tiles overflow. That
  is expected. Do not regenerate them: never run `--update-snapshots`. Say in the report which pictures differ
  (names and counts, Chromium on this PC).

## Change 2: "This picture is no longer in the project."

Kevin (Nov 18): the words shown where a picture's bytes are gone must be true both when the picture was deleted for
good and when an import left it out, on the board and wherever else those words show.

- `moodboard.pictureGone` (drawn by `PictureNode.tsx` on boards, decks, shot and scene cards, the brand card and the
  plan's underlay):
  - en: "This picture was deleted for good." becomes "This picture is no longer in the project."
  - es: "Esta imagen se eliminó para siempre." becomes "Esta imagen ya no está en el proyecto."
- The two paste notices that say the same thing change the same way, their first half kept:
  - `moodboard.pasteGone`: "…its picture has been deleted for good." becomes "…its picture is no longer in the
    project." (es: "…su imagen ya no está en el proyecto.")
  - `plan.underlay.pasteGone`: the same ending.
- Comments that quote the old sentence follow (`PictureNode.tsx`, `BoardView.tsx`), and `docs/SBD_FORMAT.md` where
  it quotes it.
- Frames' "Picture missing" is already true in both cases: not touched.

### Existing assertions that change (these two and no others)

1. `src/features/moodboards/boardClipboard.test.ts`, "leaves a picture out when its stored picture is gone when the
   paste's turn comes…": `toContain('deleted for good')` becomes `toContain('no longer in the project')`.
2. `src/features/birdseye/plan/planUnderlay.test.ts`, "pastes the rest and leaves out an underlay whose picture was
   deleted for good (Empty Trash), and says so": the expected sentence ends "its picture is no longer in the
   project." The test's name stays.

## Checks to run

1. `npm run lint`.
2. Vitest, the whole suite.
3. Chromium only, these specs only: `npx playwright test e2e/scrollLane.spec.ts e2e/planLayers.spec.ts
   e2e/smoke.spec.ts e2e/visual.spec.ts --project=chromium`. Read the passed and failed counts; the visual failures
   are the expected ones, and nothing else may fail.
4. No Rust changes: no cargo run.

## Don't touch

- `e2e/planLayers.spec.ts`, and any screenshot baseline.
- Any assertion but the two named.
- `prototype/` (its scroll bar styles are not ours to use).
- `CLAUDE.md`, `docs/PLAN.md`, `docs/HANDOFF.md`, `docs/ALPHA_TEST.md`, CI, `.claude`, dependencies.

## Report

The files changed, the tests added, each check with its counts, the list of screenshots that differ, every string
changed in English and Spanish as a table, and anything uncertain: above all any scroller you left without the hook
and why.
