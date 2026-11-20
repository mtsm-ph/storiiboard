import { describe, expect, it } from 'vitest';
import { barsOverlay, laneAttribute, nextLane, NO_LANE, type LaneMeasure, type LaneState } from './scrollLane';

const measure = (over: Partial<LaneMeasure> = {}): LaneMeasure => ({ overlay: true, overflowX: false, overflowY: false, box: '300x400', ...over });

/** Runs the rule over a sequence of measures, from no lane. */
function run(...measures: LaneMeasure[]): LaneState {
  return measures.reduce(nextLane, NO_LANE);
}

describe('barsOverlay', () => {
  it('reads overlay when a scrolling box is as wide inside as outside', () => {
    expect(barsOverlay(100, 100)).toBe(true);
  });

  it('reads classic bars when the bar takes room of its own', () => {
    expect(barsOverlay(100, 85)).toBe(false);
    expect(barsOverlay(100, 99)).toBe(false);
  });

  it('says nothing for a box with no width (no layout)', () => {
    expect(barsOverlay(0, 0)).toBe(false);
  });
});

describe('nextLane', () => {
  it('takes a lane up and down while the content overflows that way', () => {
    const state = run(measure({ overflowY: true }));
    expect(laneAttribute(state)).toBe('y');
  });

  it('takes a lane sideways while the content overflows sideways', () => {
    expect(laneAttribute(run(measure({ overflowX: true })))).toBe('x');
  });

  it('takes both lanes when the content overflows both ways', () => {
    expect(laneAttribute(run(measure({ overflowX: true, overflowY: true })))).toBe('both');
  });

  it('takes none where the content fits', () => {
    expect(laneAttribute(run(measure()))).toBeNull();
  });

  it('takes none with classic bars, however the content overflows, and drops one it had', () => {
    expect(laneAttribute(run(measure({ overlay: false, overflowX: true, overflowY: true })))).toBeNull();
    expect(laneAttribute(run(measure({ overflowY: true }), measure({ overlay: false, overflowY: true })))).toBeNull();
  });

  it('drops the lane once the content fits again', () => {
    const state = run(measure({ overflowY: true }), measure({ overflowY: false }));
    expect(laneAttribute(state)).toBeNull();
  });

  it('puts the lane back and keeps it while the box is the same, when taking it away made the content overflow', () => {
    // On, then off because the content fit with the lane, then overflowing again only because the lane went.
    const back = run(measure({ overflowY: true }), measure({ overflowY: false }), measure({ overflowY: true }));
    expect(laneAttribute(back)).toBe('y');
    // Held: even where the content would fit with it, the lane stays while the box doesn't change.
    const held = nextLane(back, measure({ overflowY: false }));
    expect(laneAttribute(held)).toBe('y');
    expect(laneAttribute(nextLane(held, measure({ overflowY: false })))).toBe('y');
  });

  it('lets a held lane go once the box changes', () => {
    const held = run(measure({ overflowY: true }), measure({ overflowY: false }), measure({ overflowY: true }), measure({ overflowY: false }));
    expect(laneAttribute(held)).toBe('y');
    expect(laneAttribute(nextLane(held, measure({ overflowY: false, box: '320x400' })))).toBeNull();
  });

  it('holds nothing when the content overflows again after the box changed', () => {
    // Off at one box, overflowing at another: an ordinary lane, dropped as soon as the content fits.
    const state = run(measure({ overflowY: true }), measure({ overflowY: false }), measure({ overflowY: true, box: '320x400' }));
    expect(laneAttribute(state)).toBe('y');
    expect(laneAttribute(nextLane(state, measure({ overflowY: false, box: '320x400' })))).toBeNull();
  });

  it('holds each axis on its own', () => {
    const state = run(measure({ overflowX: true }), measure(), measure({ overflowX: true }), measure({ overflowY: true }));
    expect(laneAttribute(state)).toBe('both');
    expect(laneAttribute(nextLane(state, measure()))).toBe('x');
  });
});
