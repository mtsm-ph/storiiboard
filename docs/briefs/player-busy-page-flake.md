# Brief: the cause of player.spec's "a page too busy…" flake on WebKit (Kevin, Nov 18 and 19)

Work in the repo folder, on the branch the main session names. Read CLAUDE.md first. Never commit, push or merge.
Use Edit and Write for every change. Logs and probes go in test-results/. Only the spec named below runs on this PC.

## The flake

`e2e/player.spec.ts` › "a page too busy to see every frame shows a frame or two past the out point, never more than
it was late by (2.8)" fails now and then on the Mac (WebKit), then passes on retry: flaky in five checkpoint runs.
The latest (checkpoint/627-clean, Nov 19, retry 0, 9.3 s):

```
Error: frame 22 reported after 1 missed (1 allowed in this run)
Expected: <= 1   Received: 2
  at expectInside (e2e/player.spec.ts:81)   at e2e/player.spec.ts:423
```

The clip is In 10, Out 20 at 23.976 fps. The test stalls the page 90 ms every 250 ms; `presentedFrames` (the spec's
helper) records each `requestVideoFrameCallback` report as a frame number, `Math.round(mediaTime * 24000 / 1001)`,
and how many frames were missed before it: from `metadata.presentedFrames` where the engine gives it, else from the
time since the last report. `expectInside` allows as many frames past the out point as the page missed in that run.
Here a report said frame 22 with one frame missed before it.

Kevin's rule: find the cause; **no retry, no wait, no wider tolerance** as the fix. If the cause is in the app, the
app is fixed; if it's in how the test counts, the count is made right, and the test still fails on the app shown a
frame further past the out point than it was late.

## What to find out

1. How the clip preview turns at the out point: find the code behind `[data-clip-preview]` (src/features/video or
   src/features/storyboard; search for `requestVideoFrameCallback`) and say exactly what it compares (mediaTime?
   currentTime? a frame number rounded how?) and when it seeks back to the in point.
2. Whether the test's frame number and the app's agree on WebKit. Candidates to check, by reading the code and, if
   you can, by measuring:
   - WebKit's `mediaTime` may not sit on the frame's own timestamp (rounding up a frame, or reporting the current
     time rather than the frame's), so `Math.round` can name the next frame;
   - WebKit's `presentedFrames` may count differently from Chromium's (frames composited vs painted), so `missed`
     undercounts by one when the page stalls;
   - the turn's seek may itself present a frame past the out point before the in frame.
   Say which of these (or another) the evidence supports, and how sure you are.
3. Measuring: try the spec in Playwright's WebKit on this PC (`npx playwright test e2e/player.spec.ts
   --project=webkit -g "too busy"`). Windows WebKit lacks OffscreenCanvas, which may stop it; if it runs, record each
   callback's raw values (`mediaTime`, `presentedFrames`, `expectedDisplayTime`, `now`, the video's `currentTime`)
   to test-results/ and compare with Chromium on the same clip. If WebKit can't run here, say so; don't install
   anything.
4. Add, to this test only, an attachment (`testInfo.attach`, JSON, a few KB) of those raw values for every run, pass
   or fail, so the next Mac checkpoint records what WebKit reports even when it passes. It changes no assertion.

## The fix

- If the cause is clear from the code and the measurements, fix it at its cause and say why it's the cause.
- If it isn't clear yet, make no fix: the attachment goes in alone, and the next checkpoint's Mac run gives the
  numbers. Say what the numbers would need to show for each candidate.
- Never change `expectInside`'s rule to allow more than the frames missed, and never add `test.retry`, a timeout or
  a wait.

## Checks

- `npm run lint`, `npx tsc --noEmit`; Vitest for any app file you touched (run from `C:\` spelled upper case).
- `npx playwright test e2e/player.spec.ts --project=chromium`, then `npm run failed-tests`; and the WebKit run above
  if it works here. Paste the counts.

## Don't touch

- Any other test, screenshot baselines, CI, .claude, CLAUDE.md, PLAN.md, HANDOFF.md, dependencies.

## Report

The turn's code and what it compares; the evidence for each candidate; the cause, or what the attachment will show;
the change, if any; check results with counts.
