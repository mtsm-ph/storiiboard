# Brief: the scroll lane, round 6b (#222): planLayers.spec.ts:324 in WebKit, by fixing the app

Sent to round 6's builder, which had reproduced the Mac's failure in Playwright's WebKit on Windows: at 200 px the
Layers tile's content was 378 px against a 375 px body, so the lane came on and Show all and My department wrapped,
which the test forbids. It also found a latch: squeezed from 240 to 200 px, the lane stayed on even in Chromium.

The decision (main session):
1. That test and its assertion at line 354 (`Math.abs(all.y - mine.y) < 1`) were on v2 before #222: they stay exactly
   as they are, and the app meets them.
2. Fix the latch in src/ui/scrollLane.ts, for every host: the lane is on only when the content overflows without the
   lane, so the lane's own room never keeps it on; 240 to 200 px ends with no lane, as going straight to 200 does.
   Kevin's rule stays: by whether the scroll bar overlays, never by the system's name. Unit tests for the latch, and
   no flip-flop at the boundary.
3. Make the Layers tile fit at 200 px in WebKit with nothing anyone sees changed at the default size (rows the same
   height in both engines); if it can't, stop and report options with pictures; build no visible design change.
4. Run planLayers, scrollLane, presets, reorder and storyboard in Chromium, and planLayers, scrollLane and presets in
   WebKit on Windows; types, lint, and the unit tests of src/ui and src/features/birdseye.
5. Don't touch e2e/visual.spec.ts or any baseline.
