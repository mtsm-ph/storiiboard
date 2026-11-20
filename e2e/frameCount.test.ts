import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countMissed, expectInside, frameOf, type Presented, type RawReport } from './frameCount';

// The count player.spec.ts's busy-page test makes (e2e/frameCount.ts), on the reports kept from the checkpoint runs
// (e2e/fixtures/frameReports) and on made-up ones. Runs in Vitest: no browser, no clip.

interface Kept {
  engine: string;
  clip: { in: number; out: number; fps: string };
  seen: Presented[];
  raw: RawReport[];
}

const kept = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/frameReports/${name}.json`, import.meta.url), 'utf8')) as Kept;

const FRAME_MS = 1001000 / 24000;

/**
 * The count as the spec made it before: from `presentedFrames` where the engine gave it, else the time since the last
 * report. Here only to show what it got wrong.
 */
const oldCount = (raw: readonly RawReport[]): Presented[] =>
  raw.map((report, i) => {
    const before = raw[i - 1];
    const missed = !before
      ? 0
      : report.presentedFrames !== null && before.presentedFrames !== null
        ? report.presentedFrames - before.presentedFrames - 1
        : Math.round((report.now - before.now) / FRAME_MS) - 1;
    return { frame: frameOf(report.mediaTime), missed: Math.max(0, missed) };
  });

/** Steps forward where the new count finds more missed frames than the old one did, and where it finds fewer. */
const againstOld = (raw: readonly RawReport[], old: readonly Presented[]) => {
  const forward = countMissed(raw).flatMap((s, i) => {
    const before = raw[i - 1];
    return before && s.frame >= frameOf(before.mediaTime) ? [{ i, now: s.missed, old: old[i]?.missed ?? 0 }] : [];
  });
  return { more: forward.filter((s) => s.now > s.old).map((s) => s.i), fewer: forward.filter((s) => s.now < s.old).map((s) => s.i) };
};

/**
 * A made-up run: each step a frame number, the time it was reported at, the engine's `presentedFrames` and, if given,
 * the picture's presentation time.
 */
const run = (steps: [frame: number, now: number, presented: number | null, presentation?: number][]): RawReport[] =>
  steps.map(([frame, now, presented, presentation]) => ({
    now,
    mediaTime: Math.round(((frame * 1001) / 24000) * 1e6) / 1e6,
    presentedFrames: presented,
    expectedDisplayTime: null,
    presentationTime: presentation ?? null,
    currentTime: 0,
    paused: false,
  }));

/** Frames on time from `first` to `last`, one frame apart in media time, presentedFrames and the clock. */
const onTime = (first: number, last: number, from = 1000): [number, number, number][] =>
  Array.from({ length: last - first + 1 }, (_, i) => [first + i, from + i * FRAME_MS, first + i]);

const ruleOk = (seen: readonly Presented[]) => () => {
  expectInside(seen, 10, 20, expect);
};

describe('the kept frame reports', () => {
  it.each([
    ['nov19a-webkit', 3],
    ['nov19b-webkit', 5],
    ['nov19c-webkit', 5],
  ])('%s passes with the new count, which finds more missed than presentedFrames on %i steps forward, exactly where the media time jumped further', (name, steps) => {
    const { raw, seen, clip } = kept(name);
    expect(clip).toEqual({ in: 10, out: 20, fps: '24000/1001' });
    // The old count rebuilt here is the one the run made (its `seen`), from the raw values alone.
    expect(oldCount(raw)).toEqual(seen);
    expect(ruleOk(countMissed(raw))).not.toThrow();
    // The steps forward where the media time went further than presentedFrames rose.
    const jumped = raw.flatMap((report, i) => {
      const before = raw[i - 1];
      if (!before || report.presentedFrames === null || before.presentedFrames === null) return [];
      const frames = frameOf(report.mediaTime) - frameOf(before.mediaTime);
      return frames > 0 && frames > report.presentedFrames - before.presentedFrames ? [i] : [];
    });
    expect(jumped).toHaveLength(steps);
    expect(againstOld(raw, seen)).toEqual({ more: jumped, fewer: [] });
    // Every step back is a real turn: it lands inside the clip, and counts 0.
    countMissed(raw).forEach((s, i) => {
      const before = raw[i - 1];
      if (before && s.frame < frameOf(before.mediaTime)) expect([s.frame <= 20, s.missed]).toEqual([true, 0]);
    });
  });

  it('nov19c-chromium passes and the new count equals the old one on every step', () => {
    const { raw, seen } = kept('nov19c-chromium');
    expect(oldCount(raw)).toEqual(seen);
    expect(countMissed(raw)).toEqual(seen);
    expect(ruleOk(countMissed(raw))).not.toThrow();
  });
});

describe('the count', () => {
  it('counts the frames the media time skipped on a step forward, none for a frame reported twice', () => {
    const seen = countMissed(run([[12, 1000, 2], [13, 1042, 3], [16, 1167, 4], [16, 1209, 5], [17, 1250, 6]]));
    expect(seen).toEqual([
      { frame: 12, missed: 0 },
      { frame: 13, missed: 0 },
      { frame: 16, missed: 2 },
      { frame: 16, missed: 0 },
      { frame: 17, missed: 0 },
    ]);
  });

  it('caps a jump by the time the picture took: presentation times where both are given, else the callbacks', () => {
    // 13 → 16 in one frame's time: no time for any to be missed.
    expect(countMissed(run([[13, 1000, 3], [16, 1000 + FRAME_MS, 4]])).map((s) => s.missed)).toEqual([0, 0]);
    // The callback came at once, but the pictures were three frames apart: 2 missed.
    expect(countMissed(run([[13, 1000, 3, 900], [16, 1001, 4, 900 + 3 * FRAME_MS]])).map((s) => s.missed)).toEqual([0, 2]);
    // Long enough for 5, but the jump skipped only 2.
    expect(countMissed(run([[13, 1000, 3], [16, 1000 + 6 * FRAME_MS, 4]])).map((s) => s.missed)).toEqual([0, 2]);
  });

  it('counts a step back (the turn to the in point) as 0, however long it took, and the first report as on time', () => {
    expect(countMissed(run([[19, 1000, 8], [10, 1000 + 2 * FRAME_MS, 10]])).map((s) => s.missed)).toEqual([0, 0]);
    expect(countMissed(run([[20, 2000, null], [10, 2001, null]])).map((s) => s.missed)).toEqual([0, 0]);
  });

  it('fails a jump past the out point with no time to match: 19, then 25 one frame later, then the turn', () => {
    const seen = countMissed(run([[19, 1000, 19], [25, 1041.7, 20], [10, 1083.4, 21]]));
    expect(ruleOk(seen)).toThrow(/frame 25 reported after 0 missed \(0 allowed in this run\)/);
  });

  it('lends nothing from a step back that lands past the out point: 19, 22, back to 21, then 22 to 26 on time', () => {
    const seen = countMissed(run([[19, 1000, 19], [22, 1041.7, 22], [21, 1250, 23], ...onTime(22, 26, 1250 + FRAME_MS)]));
    expect(seen.find((s) => s.frame === 21)?.missed).toBe(0);
    // 22 came a frame's time after 19, so nothing was missed before it, and the run fails there.
    expect(ruleOk(seen)).toThrow(/frame 22 reported after 0 missed \(0 allowed in this run\)/);
  });

  it("passes the old failure's shape that the old count failed: 18, 21 (2 skipped, presentedFrames says 1), 22, the turn", () => {
    const raw = run([...onTime(16, 18), [21, 1000 + 5 * FRAME_MS, 20], [22, 1000 + 6 * FRAME_MS, 21], [10, 1000 + 7 * FRAME_MS, 22]]);
    expect(() => {
      expectInside(oldCount(raw), 10, 20, expect);
    }).toThrow(/frame 22 reported after 0 missed \(1 allowed in this run\)/);
    expect(countMissed(raw).find((s) => s.frame === 21)?.missed).toBe(2);
    expect(ruleOk(countMissed(raw))).not.toThrow();
  });

  it("passes the failure checkpoint/627-clean reported: 18, 19, then 22 (20 and 21 skipped, presentedFrames up 2), the turn", () => {
    // That run's raw values were never kept (the attachment came later), so this is the shape its message fits, not a
    // replay: "frame 22 reported after 1 missed (1 allowed in this run)", Expected <= 1, Received 2.
    const raw = run([...onTime(17, 19), [22, 1000 + 5 * FRAME_MS, 21], [10, 1000 + 6 * FRAME_MS, 22]]);
    expect(() => {
      expectInside(oldCount(raw), 10, 20, expect);
    }).toThrow(/frame 22 reported after 1 missed \(1 allowed in this run\)/);
    expect(countMissed(raw).find((s) => s.frame === 22)?.missed).toBe(2);
    expect(ruleOk(countMissed(raw))).not.toThrow();
  });

  it('still fails a real overshoot: every frame on time but no turn at the out point fails on 21', () => {
    const seen = countMissed(run(onTime(19, 22)));
    expect(seen.map((s) => s.missed)).toEqual([0, 0, 0, 0]);
    expect(ruleOk(seen)).toThrow(/frame 21 reported after 0 missed \(0 allowed in this run\)/);
  });

  it('still fails a real overshoot: late by one (19 → 21), then 22 on time, fails on 22', () => {
    const seen = countMissed(run([[19, 1000, 19], [21, 1000 + 2 * FRAME_MS, 21], [22, 1000 + 3 * FRAME_MS, 22]]));
    expect(seen.map((s) => s.missed)).toEqual([0, 1, 0]);
    expect(ruleOk(seen)).toThrow(/frame 22 reported after 0 missed \(1 allowed in this run\)/);
  });
});
