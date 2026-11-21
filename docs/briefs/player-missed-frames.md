# Brief: player.spec counts missed frames from the jump in media time (Kevin, Nov 19)

Branch `fix/player-missed-frames`, from `v2`. Work in the repo folder. Read CLAUDE.md first, then
docs/briefs/player-busy-page-flake.md (the cause hunt this follows). Never commit, push or merge. Use Edit and Write
for every change. Logs and probes go in test-results/.

## The cause (found from the frame reports #202 keeps)

e2e/player.spec.ts › "a page too busy to see every frame shows a frame or two past the out point, never more than it
was late by (2.8)" is flaky on WebKit. `presentedReports` counts the frames missed before each report from
`metadata.presentedFrames` where the engine gives it. WebKit's `presentedFrames` leaves out frames it drops, so under a
stalled page it counts fewer missed frames than the picture skipped. In the four kept runs (test-results/frame-reports,
the `raw` arrays):

- WebKit nov19-a, -b, -c: 3, 5 and 5 steps where the media time jumped further than `presentedFrames` rose. Never the
  other way.
- Chromium nov19-c: 0 such steps of 27.

nov19-a shows the near miss. 18 → 21 was counted as "1 missed", but the media time says 2 were missed. A report of
frame 22 after it would have been the old failure: "frame 22 reported after 1 missed (1 allowed)".

The app is not at fault and doesn't read `presentedFrames`: ClipPreview.tsx and PlayerTile.tsx turn on `mediaTime`
alone. Confirm that with a search and say so in your report.

## The change (Kevin: yes)

- Count the frames missed before a report from the jump in media time: on a forward step, `frame − previous frame − 1`
  (at least 0), with frames as the spec numbers them now (`Math.round(mediaTime * 24000 / 1001)`).
  - A step backwards is the turn to the in point. The media time says nothing about lateness there. Keep the time
    since the last report for it, as the count does today when there's no `presentedFrames`, and comment why.
  - The first report counts as on time, as now.
- `expectInside` keeps its meaning and its limit: frames past the out point, one run of them up to the turn, never more
  than the frames missed in that run. Don't touch its rule, its message or its bounds. Only where `missed` comes from
  changes. Update the comments that describe the count.
- The raw attachment (`frame-reports.json`) stays exactly as it is, `presentedFrames` included, so later runs can still
  be compared.
- Move the count into a pure function that takes the raw reports and returns `seen` (e.g. e2e/frameCount.ts), used by
  the spec, so it can be tested without a browser. The page-side callback keeps collecting the same raw values.
- No retry, no timeout, no wait, no wider tolerance.

## Tests

A unit test of the count and of `expectInside`'s rule applied to it. Prefer Vitest: add `'e2e/**/*.test.ts'` to the
`include` in vite.config.ts if the e2e folder's tsconfig allows it, else say why and use a browserless Playwright
spec. Cases:

1. **The kept reports pass with the new count.** Copy test-results/frame-reports/*.json into
   e2e/fixtures/frameReports/ (they hold only the test clip's frame times, no personal data), with a short README
   saying where each came from (checkpoint run, engine). For each, the new count passes the rule for in 10, out 20.
   For the WebKit ones, the new count finds more missed frames than `presentedFrames` did on exactly the steps
   counted above (3, 5, 5).
2. **The old failure's shape passes.** A sequence like nov19-a's (…, 18, 21, 22, then the turn) where
   `presentedFrames` says 1 missed before 22: the old count fails it (show that with the old rule computed in the
   test), the new count passes it.
3. **A real overshoot still fails.** Each frame on time (media time rising one frame a step) but no turn at the out
   point: 19, 20, 21, 22 → the rule fails on 21. Also: late by one (19 → 21), then 22 on time → fails on 22.
4. Chromium's kept report: the new count equals the old one on every step.

## Checks (paste counts)

`npm run lint`, `npx tsc --noEmit`, Vitest on the new test (from `C:\`, upper case), then
`npx playwright test e2e/player.spec.ts --project=chromium`, then `npm run failed-tests`. WebKit runs on GitHub's Mac,
not here.

## Don't touch

Any other test, the app, screenshot baselines, CI, .claude, CLAUDE.md, PLAN.md, HANDOFF.md, dependencies. Never
weaken, skip or delete an existing assertion.
