# Brief: the Layers tile's keys line shows only when it fits whole (#222, choice 1; Kevin, Nov 20)

Work in the repo folder on branch `fix/scroll-lane` (#222, already checked out; don't switch). You change the Layers
tile, add tests, take four pictures and run the checks below. You never commit, push or merge. Read CLAUDE.md's
Workflow and Safety sections, `docs/briefs/scroll-lane-and-picture-words.md` on this branch (what #222 is) and the
review recorded in #222's comments if you can (`gh pr view 222 --comments`).

## Where #222 stands

#222 keeps controls clear of an overlay scroll bar: a scrolling tile whose scroll bar lies over its content gets a
16 px lane (`src/ui/scrollLane.ts`). It was built and reviewed, then stopped, because of one tile:

- At its default size the Layers tile already overflows: its body is 376 px high and its content 433 px, and what
  spills is the keys line under the rows (`layers.keys`: "On the plan, 1 to 7 solo a layer and 0 shows all. A focus
  view on this computer: nothing is saved in the project.").
- So on a Mac the tile gets the lane, the rows get 16 px narrower, the Grip row wraps, and the list no longer shows
  whole. That fails an existing test: `e2e/planLayers.spec.ts` › "each layer is one line where its name fits and wraps
  where it doesn't, never cut off; every row shows without scrolling".

Kevin chose, Nov 20, his words:

> #222: choice 1. The keys line is what spills, so it shows only when the tile has room for it whole: never cut off,
> never the cause of a scroll bar. Each key is also said in its own control's title (Solo's with its number, Show
> all's with 0), in words that say it works on the plan. At the default size the tile then doesn't scroll and both
> rules hold.

## What to build (`src/features/birdseye/plan/LayersTile.tsx` and the locale files)

1. **The keys line shows only when the tile has room for it whole.**
   - It is shown when the rows, the buttons above them and the whole keys line fit in the tile's body without
     scrolling, at the tile's present width. Otherwise it is not shown at all: never cut off, never the reason the
     body scrolls.
   - It takes no room when not shown. Showing or hiding it never changes the size of what decides it (no loop, no
     flicker while a tile is resized: measure the line's own height apart from the flow).
   - It follows the tile as it is resized, maximized, moved to a narrower column, and as the language changes.
   - When the rows themselves don't fit (a short tile), the body scrolls as today and #222's lane applies; the keys
     line is then not shown.
   - Assistive technology still gets what the line says when it isn't shown: keep its text as the description of the
     layers list (visually hidden, not removed), unless you find it is already said elsewhere; say which.
2. **Each key is also said in its own control's title.**
   - Each layer's Solo button: its title says what Solo does, as today, and the key that does it on the plan (1 to 7,
     in the rows' order: read the key from where the plan handles it, don't keep a second list).
   - Show all: a title that says what it does and that 0 does it on the plan.
   - The words must say the key works on the plan (when the plan has focus), not in this tile. New strings in en and
     es through `t()`. Suggested English: "Solo the {layer} layer: it shown, the others dimmed and locked. On the
     plan, press {key}." and "Show every layer, none locked. On the plan, press 0." Spanish to match the file's
     existing wording for these controls; put both languages' new lines in your report, for Kevin to read.
   - Accessible names stay what they are (the specs find the buttons by them); the title is the longer text.
3. **At the default size the tile doesn't scroll**, in English and in Spanish, so it gets no lane and the existing
   test above passes unchanged, and so do #222's own tests (`e2e/scrollLane.spec.ts`, `src/ui/scrollLane.test.ts`).
   If the Spanish rows or buttons still overflow at the default size without the keys line, stop and report the
   numbers: don't change the tile's default size or the rows.

No existing test or assertion changes. If one would have to (a test that expects the keys line always on screen,
say), stop and report it: the brief didn't foresee it.

## Tests to add

- `e2e/planLayers.spec.ts` (new tests; the present ones stay as they are):
  - at the default size the keys line is not on screen, the tile's body doesn't scroll (`scrollHeight` equals
    `clientHeight`) and has no lane (`data-scroll-lane` is absent), in English and in Spanish;
  - made taller (drag the tile's splitter, or maximize it), the keys line shows whole: its box lies inside the body's
    and the body still doesn't scroll;
  - made short, the body scrolls, the keys line is not shown, and it is never partly visible at any of a few
    heights in between;
  - each Solo button's title holds its key and "on the plan" (the keys in the rows' order), and Show all's holds 0;
  - the list's description still carries the line's words when it isn't shown.
- Unit tests for any pure helper (the fit rule, the key of a row).
- `src/core/i18n` tests that check the two languages hold the same keys still pass.

## The four pictures (for Kevin; never committed)

- A throwaway Playwright script under `test-results/layers-keys-line/` (never in `e2e/`) that opens a dev build with
  `?files=memory`, makes a project with a scene and a setup as planLayers.spec does, goes to Setup and saves a PNG of
  the Layers tile alone at its default size, in the language it is told (English, Spanish). It must also run on
  `v2`'s code, where the tile's markup is the same but for your change: use only selectors that exist there.
- Run it on this branch and write `private/pictures/layers-tile-after-en.png` and `layers-tile-after-es.png` (make
  the folder if it isn't there; `private/` is git-ignored).
- The main session runs the same script on `v2` for the two "before" pictures: say exactly how to run it and what
  it writes.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on the touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs src/features/birdseye src/ui src/core/i18n` (this shell's
  lower-case drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- End to end, alone (nothing else running, no edits meanwhile), counts read from the output, not the exit code:
  `npx playwright test e2e/planLayers.spec.ts e2e/scrollLane.spec.ts --project=chromium --workers=4`.
- Chromium on Windows has no overlay scroll bar, so the lane itself doesn't show here: #222's spec forces it the way
  it already does. Say which of your new tests force the overlay case and which don't.
- Logs and the picture script go under `test-results/layers-keys-line/`.

## Don't touch

- `e2e/visual.spec.ts` and its snapshots: the baselines are regenerated on GitHub, and Kevin sees every changed
  picture first. If you can tell which baselines show the Layers tile, list them in your report.
- The lane itself (`src/ui/scrollLane.ts`, `theme.css`) unless a test of yours shows a fault in it: then report it.
- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.github`, `.claude`.
- No new dependency. No prettier. Single quotes, about 120 columns, comments that say why. Every word people see
  through `t()` in en and es.
- Never start a command with `python`. Nothing fetched through npx. Nothing from `private/samples`.

## Report back

How the fit is decided (in two sentences); the new strings in both languages; each new test's name and result; each
check's output line with counts; the pictures written and how to make the "before" ones; the baselines you think
show the Layers tile; every test that failed on the way, by name.
