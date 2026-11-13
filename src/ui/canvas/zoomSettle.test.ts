import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZoomSettle } from './zoomSettle';

// The zoom the canvas draws for follows a wheel or pinch only after it stops (5.7); a jump applies at once.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the zoom items are drawn for', () => {
  it('follows the zoom after it has held still for the delay, never before', () => {
    const applied: number[] = [];
    const settle = createZoomSettle(150, (z) => applied.push(z), () => false);
    settle.follow(2, true);
    vi.advanceTimersByTime(149);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([2]);
  });

  it('starts the wait again with each step of the zoom', () => {
    const applied: number[] = [];
    const settle = createZoomSettle(150, (z) => applied.push(z), () => false);
    for (const zoom of [1.1, 1.2, 1.3, 1.4]) {
      settle.follow(zoom, true);
      vi.advanceTimersByTime(100);
    }
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(applied).toEqual([1.4]);
  });

  it('applies a jump (Fit, Reset, the keys) at once and drops a wait in progress', () => {
    const applied: number[] = [];
    const settle = createZoomSettle(150, (z) => applied.push(z), () => false);
    settle.follow(2, true);
    settle.follow(1, false);
    expect(applied).toEqual([1]);
    vi.advanceTimersByTime(500);
    expect(applied).toEqual([1]);
  });

  it('waits while a gesture is underway and applies it once it is let go', () => {
    const applied: number[] = [];
    let busy = true;
    const settle = createZoomSettle(150, (z) => applied.push(z), () => busy);
    settle.follow(3, true);
    vi.advanceTimersByTime(1000);
    expect(applied).toEqual([]);
    busy = false;
    vi.advanceTimersByTime(150);
    expect(applied).toEqual([3]);
  });

  it('applies nothing once cancelled', () => {
    const applied: number[] = [];
    const settle = createZoomSettle(150, (z) => applied.push(z), () => false);
    settle.follow(3, true);
    settle.cancel();
    vi.advanceTimersByTime(1000);
    expect(applied).toEqual([]);
  });
});
