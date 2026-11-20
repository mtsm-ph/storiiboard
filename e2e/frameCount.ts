// How e2e/player.spec.ts counts the frames a clip preview shows and the frames it missed between two reports, kept out
// of the spec so e2e/frameCount.test.ts can check the count on the reports kept from earlier runs, without a browser.

/** The fixture clip's rate, 24000/1001: a frame's number is its media time in these units, rounded. */
const FPS = 24000 / 1001;
const FRAME_MS = 1000 / FPS;

export interface Presented {
  frame: number;
  /** Frames the picture went past unreported since the report before: 0 when it saw every one. */
  missed: number;
}

/**
 * What the webview handed one frame callback, as it gave it: kept so a run records how its engine reports frames (the
 * busy-page test attaches them, pass or fail). Times in ms rounded to 0.1, media times in seconds to 6 places.
 */
export interface RawReport {
  now: number;
  mediaTime: number;
  presentedFrames: number | null;
  expectedDisplayTime: number | null;
  presentationTime: number | null;
  currentTime: number;
  paused: boolean;
}

export const frameOf = (mediaTime: number) => Math.round(mediaTime * FPS);

/**
 * Each report's frame, and how many frames it came late by. On a step forward, the frames the media time skipped, at
 * most as many as the time the picture took allows. Not `presentedFrames`: WebKit leaves the frames it drops out of it,
 * so under a stalled page it counted fewer than the picture skipped (18 then 21 read as 1 missed, the media time says
 * 2), and a frame past the out point was then blamed on the app. The jump says which frames were skipped; the time
 * between the two pictures (their presentation times where the engine gives both, else the callbacks') says how late
 * the page could have been. A jump with no time to match is the picture going too far, not lateness, and still fails.
 * A step back is the turn to the in point, which lands inside the clip and starts a new run, so it counts 0: a step back
 * that landed past the out point is no turn, and lends nothing to the frames after it. The first report has nothing
 * before it and counts as on time.
 */
export function countMissed(raw: readonly RawReport[]): Presented[] {
  return raw.map((report, i) => {
    const frame = frameOf(report.mediaTime);
    const before = raw[i - 1];
    if (!before) return { frame, missed: 0 };
    const previous = frameOf(before.mediaTime);
    if (frame < previous) return { frame, missed: 0 };
    const gap =
      report.presentationTime !== null && before.presentationTime !== null ? report.presentationTime - before.presentationTime : report.now - before.now;
    return { frame, missed: Math.max(0, Math.min(frame - previous - 1, Math.round(gap / FRAME_MS) - 1)) };
  });
}

/**
 * How late each report ran for its own frame, in whole frames: its callback's time minus its picture's, never below 0, and
 * 0 when the engine gives no presentation time. On checkpoint nov20-a the out frame's report ran over two frames late and
 * the picture was on 22 when the clip turned, which `countMissed` (frames skipped between reports) has no way to see.
 */
export function lateness(raw: readonly RawReport[]): number[] {
  return raw.map((report) =>
    report.presentationTime === null ? 0 : Math.max(0, Math.floor((report.now - report.presentationTime) / FRAME_MS)),
  );
}

/** The few matchers expectInside uses, so the spec hands it Playwright's `expect` and the unit test Vitest's. */
type Expect = (
  actual: number,
  message?: string,
) => { toBeGreaterThanOrEqual: (expected: number) => unknown; toBeLessThanOrEqual: (expected: number) => unknown };

/**
 * Every frame shown is inside the clip, from `from` to `to`. The clip turns on the callback that reports its out frame, so
 * a frame past it can only have been shown while the page was too busy to be told: the frames past the out point, one run of
 * them up to the turn, are allowed as many as the page missed in that run. A page under load, as a suite running in parallel
 * is, does this; a count with no slack failed on it (21 where 20). With `late` (from `lateness`), a run also starts with as
 * many frames as the report that turned the clip ran late by: the out frame's own report (the first of them in a row just
 * before the run), else the run's first report. Without it every report counts as on time.
 */
export function expectInside(seen: readonly Presented[], from: number, to: number, expect: Expect, late?: readonly number[]) {
  expect(Math.min(...seen.map((s) => s.frame))).toBeGreaterThanOrEqual(from);
  let allowed = 0;
  let inRun = false;
  // The lateness of the first of the out frame's reports just before this point, null when the last report wasn't one.
  let outLate: number | null = null;
  let turnLate = 0;
  seen.forEach(({ frame, missed }, i) => {
    if (frame <= to) {
      allowed = 0;
      inRun = false;
      outLate = frame === to ? (outLate ?? late?.[i] ?? 0) : null;
      return;
    }
    if (!inRun) {
      inRun = true;
      turnLate = outLate ?? late?.[i] ?? 0;
      outLate = null;
      allowed = turnLate;
    }
    allowed += missed;
    const turn = turnLate > 0 ? `, the turn's report ran ${String(turnLate)} frame${turnLate === 1 ? '' : 's'} late` : '';
    expect(frame - to, `frame ${String(frame)} reported after ${String(missed)} missed (${String(allowed)} allowed in this run)${turn}`).toBeLessThanOrEqual(allowed);
  });
}
