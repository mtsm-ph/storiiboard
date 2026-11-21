# Brief: the Layers tile, round 3: read the layout once it has settled; prove it settles (#222; Nov 20)

Branch `fix/scroll-lane` (checked out, with rounds 1 and 2 uncommitted in it: keep them). Never commit, push or
merge.

## Why

Round 2's run had one existing test failing one time in three: `e2e/planLayers.spec.ts` › "each layer is one line
where its name fits and wraps where it doesn't, never cut off; every row shows without scrolling" (about line 306),
with `nameFirst: false` for the camera row right after `squeeze(170)`.

The test sets the tile's width and reads the rows in the very next call. Since #222 the app answers a resize a frame
or two later: the scroll lane and the keys line each measure in a ResizeObserver callback deferred to the next
animation frame. So a read straight after the resize can catch the layout mid-change. A person sees the settled
layout; the test must read that.

## 1. The existing test: one change, named here (the main session asks for it)

In that test only: before each block of reads (at the start, after `squeeze(200)`, after `squeeze(170)`), wait for
the tile's layout to settle, then run the same reads and the same assertions, unchanged. "Settled" means
`rowLayout(page)` (and the lane attribute, and whether the keys line shows) gives the same answer on two reads two
animation frames apart; poll that with Playwright's `expect.poll` or a small helper in the spec, never a fixed wait.
Every `expect` in the test stays exactly as it is. Put a two-line comment on the helper saying why (the lane and the
keys line answer a resize in the next frame).

## 2. A new test: it settles, and never swings

After `squeeze(170)`, then back to the default width, then `squeeze(200)`: record, on every animation frame for 20
frames after each change, whether the keys line shows and the lane attribute. Each settles within 3 frames and then
stays the same for the rest of the 20; neither flips back and forth. In English, and once in Spanish.

## 3. No other change

No other existing test or assertion changes. If the app itself turns out to swing (part 2 fails), stop and report:
don't fix it by waiting longer.

## Checks

`npx tsc --noEmit`; `npx eslint e2e/planLayers.spec.ts`; `npx playwright test e2e/planLayers.spec.ts
e2e/scrollLane.spec.ts --project=chromium --workers=4 --repeat-each=5` alone, counts read from the output. Logs under
`test-results/layers-keys-line/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

The helper; the new test's name and result; the repeat run's counts; whether anything swung.
