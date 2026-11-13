import { describe, expect, it } from 'vitest';
import { distanceToPath, facingSide, flatten, headDirections, headPoints, pathHits, pathMiddle, pathTouchesRect, routeBetween, segmentCount, sideMidpoint, sideNormal, SIDES, snapEnd, trimmed, type Anchor, type Path } from './routing';
import { hitsPoint } from './hitTest';
import type { Geometry, Point, Side } from './types';

const box = (x: number, y: number, rotation = 0): Geometry => ({ x, y, width: 100, height: 60, rotation });
const left = box(0, 0);
const right = box(300, 0);
const below = box(0, 200);
const at = (b: Geometry, side: Side | 'auto' = 'auto'): Anchor => ({ box: b, side });
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};
const points = (path: Path): Point[] => path.points;
const pt = (path: Path, i: number): Point => {
  const p = path.points.at(i);
  if (!p) throw new Error('no such point');
  return p;
};

describe('sides of a box', () => {
  it('finds the side midpoints and normals, upright', () => {
    near(sideMidpoint(left, 'right'), { x: 100, y: 30 });
    near(sideMidpoint(left, 'top'), { x: 50, y: 0 });
    near(sideMidpoint(left, 'left'), { x: 0, y: 30 });
    near(sideMidpoint(left, 'bottom'), { x: 50, y: 60 });
    near(sideNormal(left, 'bottom'), { x: 0, y: 1 });
  });

  it('turns the midpoints and the normals with the box, clockwise round its middle', () => {
    const turned = box(0, 0, 90);
    // Turned a quarter, the right side faces down.
    near(sideNormal(turned, 'right'), { x: 0, y: 1 });
    near(sideMidpoint(turned, 'right'), { x: 50, y: 80 });
    near(sideMidpoint(turned, 'top'), { x: 80, y: 30 });
  });

  it('faces the side the line to a point crosses', () => {
    expect(facingSide(left, { x: 500, y: 30 })).toBe('right');
    expect(facingSide(left, { x: -500, y: 30 })).toBe('left');
    expect(facingSide(left, { x: 50, y: 500 })).toBe('bottom');
    expect(facingSide(left, { x: 50, y: -500 })).toBe('top');
    // A turned box faces by its own sides.
    expect(facingSide(box(0, 0, 90), { x: 50, y: 500 })).toBe('right');
  });
});

describe('straight connectors', () => {
  it('runs from one anchor to the other on every pair of sides', () => {
    for (const a of SIDES) {
      for (const b of SIDES) {
        const path = routeBetween(at(left, a), at(right, b), 'straight');
        expect(path.kind).toBe('line');
        near(pt(path, 0), sideMidpoint(left, a));
        near(pt(path, 1), sideMidpoint(right, b));
        expect(points(path)).toHaveLength(2);
      }
    }
  });

  it('picks the side facing the other end for auto, each time', () => {
    const path = routeBetween(at(left), at(right), 'straight');
    near(pt(path, 0), { x: 100, y: 30 });
    near(pt(path, 1), { x: 300, y: 30 });
    const down = routeBetween(at(left), at(below), 'straight');
    near(pt(down, 0), { x: 50, y: 60 });
    near(pt(down, 1), { x: 50, y: 200 });
  });

  it('joins a free end at its point', () => {
    const path = routeBetween(at(left, 'right'), { point: { x: 400, y: 400 } }, 'straight');
    expect(points(path)).toEqual([{ x: 100, y: 30 }, { x: 400, y: 400 }]);
  });
});

describe('elbow connectors', () => {
  const axisAligned = (path: Path) =>
    points(path).every((p, i, all) => i === 0 || Math.abs(p.x - (all[i - 1]?.x ?? NaN)) < 1e-6 || Math.abs(p.y - (all[i - 1]?.y ?? NaN)) < 1e-6);

  const LAYOUTS: Record<string, Geometry> = {
    level: box(300, 0),
    offset: box(300, 120),
    below: box(0, 200),
    belowLeft: box(-250, 160),
    above: box(20, -200),
    overlapping: box(60, 20),
    behind: box(-300, 10),
    touching: box(100, 0),
    close: box(110, 100),
    turned: box(300, 100, 30),
    turnedBehind: box(-300, 40, 70),
  };
  /** The right angle nearest a side’s turned normal: the way an elbow leaves or arrives. */
  const axisOf = (g: Geometry, side: Side) => {
    const n = sideNormal(g, side);
    return Math.abs(n.x) >= Math.abs(n.y) ? { x: Math.sign(n.x), y: 0 } : { x: 0, y: Math.sign(n.y) };
  };
  /** Whether a segment runs through the inside of a box (its edges don't count). */
  const through = (a: Point, b: Point, g: Geometry) => {
    const inner = { ...g, x: g.x + 1, y: g.y + 1, width: g.width - 2, height: g.height - 2 };
    for (let i = 1; i < 40; i += 1) {
      if (hitsPoint(inner, { x: a.x + ((b.x - a.x) * i) / 40, y: a.y + ((b.y - a.y) * i) / 40 })) return true;
    }
    return false;
  };

  it('leaves along the start side, arrives against the end side, crosses neither box, at most five segments, for every pair of sides and layout', () => {
    for (const [name, target] of Object.entries(LAYOUTS)) {
      for (const a of SIDES) {
        for (const b of SIDES) {
          const label = `${name}: ${a} to ${b}`;
          // An end buried in the other box (overlapping boxes) has no way out that stays clear of it.
          const buried = (g: Geometry, p: Point) => hitsPoint({ ...g, x: g.x + 1, y: g.y + 1, width: g.width - 2, height: g.height - 2 }, p);
          const outPoint = { x: sideMidpoint(left, a).x + axisOf(left, a).x * 3, y: sideMidpoint(left, a).y + axisOf(left, a).y * 3 };
          const inPoint = { x: sideMidpoint(target, b).x + axisOf(target, b).x * 3, y: sideMidpoint(target, b).y + axisOf(target, b).y * 3 };
          if (buried(target, outPoint) || buried(left, inPoint) || buried(target, sideMidpoint(left, a)) || buried(left, sideMidpoint(target, b))) continue;
          const path = routeBetween(at(left, a), at(target, b), 'elbow');
          const pts = points(path);
          expect(axisAligned(path), label).toBe(true);
          expect(segmentCount(path), label).toBeLessThanOrEqual(5);
          near(pt(path, 0), sideMidpoint(left, a));
          near(pt(path, -1), sideMidpoint(target, b));
          const first = { x: pt(path, 1).x - pt(path, 0).x, y: pt(path, 1).y - pt(path, 0).y };
          const last = { x: pt(path, -1).x - pt(path, -2).x, y: pt(path, -1).y - pt(path, -2).y };
          const out = axisOf(left, a);
          const into = axisOf(target, b);
          expect(Math.sign(first.x) + 0, label).toBe(out.x);
          expect(Math.sign(first.y) + 0, label).toBe(out.y);
          expect(Math.sign(last.x) + 0, label).toBe(-into.x + 0);
          expect(Math.sign(last.y) + 0, label).toBe(-into.y + 0);
          for (let i = 1; i < pts.length; i += 1) {
            expect(through(pts[i - 1] as Point, pts[i] as Point, left), label).toBe(false);
            expect(through(pts[i - 1] as Point, pts[i] as Point, target), label).toBe(false);
          }
        }
      }
    }
  });

  it('leaves each attached side by the stand-off, and splits a smaller room in half', () => {
    // Right side to the left side of a box beside it, with room: a Z whose bend is half way.
    const z = routeBetween(at(left, 'right'), at(box(300, 100), 'left'), 'elbow');
    expect(points(z)).toEqual([{ x: 100, y: 30 }, { x: 200, y: 30 }, { x: 200, y: 130 }, { x: 300, y: 130 }]);
    // Right side to the top of a box below and to the right, with room: an L.
    const l = routeBetween(at(left, 'right'), at(box(300, 200), 'top'), 'elbow');
    expect(points(l)).toEqual([{ x: 100, y: 30 }, { x: 350, y: 30 }, { x: 350, y: 200 }]);
    // Both leave the right: a C out past the farther one by 16.
    const c = routeBetween(at(left, 'right'), at(box(300, 100), 'right'), 'elbow');
    expect(points(c)).toEqual([{ x: 100, y: 30 }, { x: 416, y: 30 }, { x: 416, y: 130 }, { x: 400, y: 130 }]);
    // Only 10 apart: a half-way Z, each end leaving by 5, the last segment arriving against the left side's normal.
    const close = routeBetween(at(left, 'right'), at(box(110, 100), 'left'), 'elbow');
    expect(points(close)).toEqual([{ x: 100, y: 30 }, { x: 105, y: 30 }, { x: 105, y: 130 }, { x: 110, y: 130 }]);
  });

  it('goes out, across, along, across and in when a box is in the way: five segments, never through the box', () => {
    // From a box's right side to the left side of one behind it: out, up and over, back, down, and in.
    const path = routeBetween(at(left, 'right'), at(box(-300, 10), 'left'), 'elbow');
    expect(segmentCount(path)).toBe(5);
    expect(points(path)[1]).toEqual({ x: 116, y: 30 });
    expect(pt(path, -1)).toEqual({ x: -300, y: 40 });
    expect(pt(path, -2).x).toBeLessThanOrEqual(-316);
  });

  it('bends once between two free ends, and handles a free end beside an attached one', () => {
    const free = routeBetween({ point: { x: 0, y: 0 } }, { point: { x: 100, y: 50 } }, 'elbow');
    expect(points(free)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]);
    expect(segmentCount(free)).toBe(2);
    const half = routeBetween({ point: { x: 500, y: 300 } }, at(left, 'right'), 'elbow');
    expect(axisAligned(half)).toBe(true);
    near(pt(half, 0), { x: 500, y: 300 });
    near(pt(half, -1), { x: 100, y: 30 });
    const attachedToFree = routeBetween(at(left, 'right'), { point: { x: 10, y: 300 } }, 'elbow');
    // No room to the right of the free end: out by 16 first.
    expect(points(attachedToFree)[1]).toEqual({ x: 116, y: 30 });
  });

  it('uses the nearest right angle for a turned box and still ends on its side', () => {
    const turned = box(300, 0, 30);
    const path = routeBetween(at(left, 'right'), at(turned, 'left'), 'elbow');
    expect(axisAligned(path)).toBe(true);
    near(pt(path, -1), sideMidpoint(turned, 'left'));
  });

  it('draws a line when the ends are in line', () => {
    const straight = routeBetween(at(left, 'right'), at(box(300, 0), 'left'), 'elbow');
    expect(points(straight)).toEqual([{ x: 100, y: 30 }, { x: 300, y: 30 }]);
  });
});

describe('curved connectors', () => {
  it('leaves an attached end along its normal by a third of the distance', () => {
    const path = routeBetween(at(left, 'right'), at(right, 'left'), 'curved');
    expect(path.kind).toBe('curve');
    const [p0, c1, c2, p3] = path.points;
    near(p0, { x: 100, y: 30 });
    near(p3, { x: 300, y: 30 });
    const d = 200;
    near(c1, { x: 100 + d / 3, y: 30 });
    near(c2, { x: 300 - d / 3, y: 30 });
  });

  it('turns the control points with a turned box', () => {
    const turned = box(0, 0, 90);
    const path = routeBetween(at(turned, 'right'), { point: { x: 50, y: 400 } }, 'curved');
    const [p0, c1] = path.points;
    // The right side faces down: the first control point is straight below the end.
    near(p0, { x: 50, y: 80 });
    expect(c1.x).toBeCloseTo(50, 5);
    expect(c1.y).toBeGreaterThan(80);
  });

  it('aims a free end at the other end', () => {
    const path = routeBetween({ point: { x: 0, y: 0 } }, { point: { x: 300, y: 0 } }, 'curved');
    const [, c1, c2] = path.points;
    near(c1, { x: 100, y: 0 });
    near(c2, { x: 200, y: 0 });
  });

  it('flattens to 25 points that start and end on the ends', () => {
    const path = routeBetween(at(left, 'right'), at(right, 'left'), 'curved');
    const flat = flatten(path);
    expect(flat).toHaveLength(25);
    near(flat[0] as Point, { x: 100, y: 30 });
    near(flat.at(-1) as Point, { x: 300, y: 30 });
  });
});

describe('arrowheads', () => {
  it('point along the last segment at the end, and back along the first at the start', () => {
    const straight = routeBetween(at(left, 'right'), at(right, 'left'), 'straight');
    const heads = headDirections(straight);
    near(heads.end, { x: 1, y: 0 });
    near(heads.start, { x: -1, y: 0 });
  });

  it('follow an elbow’s last segment, not the chord', () => {
    const path = routeBetween(at(left, 'right'), at(box(300, 200), 'top'), 'elbow');
    // The L comes down into the top side.
    near(headDirections(path).end, { x: 0, y: 1 });
    near(headDirections(path).start, { x: -1, y: 0 });
  });

  it('follow a curve’s tangent at each end', () => {
    const path = routeBetween(at(left, 'right'), at(right, 'left'), 'curved');
    near(headDirections(path).end, { x: 1, y: 0 });
    near(headDirections(path).start, { x: -1, y: 0 });
    const down = routeBetween(at(left, 'bottom'), at(below, 'top'), 'curved');
    near(headDirections(down).end, { x: 0, y: 1 });
  });

  it('put the tip at the very end', () => {
    const [tip, a, b] = headPoints({ x: 10, y: 10 }, { x: 1, y: 0 }, 1.5);
    expect(tip).toEqual({ x: 10, y: 10 });
    expect(a.x).toBeLessThan(10);
    expect(a.x).toBeCloseTo(b.x, 5);
    expect(a.y).toBeCloseTo(20 - b.y, 5);
  });
});

describe('arrowheads on thick lines', () => {
  it('keep their length within the stand-off and a base at least twice the line’s width', () => {
    const [tip, a, b] = headPoints({ x: 100, y: 0 }, { x: 1, y: 0 }, 24);
    expect(tip.x - a.x).toBeLessThanOrEqual(16);
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(48);
  });
});

describe('hit testing a path', () => {
  const route = (kind: 'straight' | 'elbow' | 'curved') => routeBetween(at(left, 'right'), at(box(300, 200), 'top'), kind);

  it('picks a straight path within the reach and not beyond it', () => {
    const path = route('straight');
    const mid = pathMiddle(path);
    expect(pathHits(path, mid, 6)).toBe(true);
    expect(pathHits(path, { x: mid.x + 4, y: mid.y - 4 }, 6)).toBe(true);
    expect(pathHits(path, { x: mid.x + 40, y: mid.y - 40 }, 6)).toBe(false);
  });

  it('picks each segment of an elbow', () => {
    const path = route('elbow');
    // Right 250 along y 30, then down 170 along x 350.
    expect(pathHits(path, { x: 200, y: 33 }, 6)).toBe(true);
    expect(pathHits(path, { x: 347, y: 120 }, 6)).toBe(true);
    expect(pathHits(path, { x: 200, y: 120 }, 6)).toBe(false);
  });

  it('picks a curve where it is drawn, sampled', () => {
    const path = route('curved');
    for (const p of flatten(path).filter((_, i) => i % 6 === 0)) expect(pathHits(path, { x: p.x + 2, y: p.y + 2 }, 6)).toBe(true);
    expect(distanceToPath(path, { x: 100, y: 400 })).toBeGreaterThan(50);
  });

  it('is touched by a marquee that crosses it or holds a piece of it, and not by one beside it', () => {
    const path = route('elbow');
    expect(pathTouchesRect(path, { x: 150, y: 0, width: 20, height: 60 })).toBe(true);
    expect(pathTouchesRect(path, { x: 330, y: 100, width: 40, height: 20 })).toBe(true);
    expect(pathTouchesRect(path, { x: 120, y: 100, width: 100, height: 60 })).toBe(false);
    // A marquee holding the whole path touches it too.
    expect(pathTouchesRect(path, { x: 0, y: -10, width: 500, height: 400 })).toBe(true);
    const curved = route('curved');
    const p = flatten(curved)[12];
    expect(pathTouchesRect(curved, { x: (p?.x ?? 0) - 3, y: (p?.y ?? 0) - 3, width: 6, height: 6 })).toBe(true);
  });
});

describe('snapping the pointer', () => {
  const boxes = [
    { id: 'back', box: box(0, 0) },
    { id: 'front', box: box(30, 10) },
  ];

  it('is free away from every item', () => {
    expect(snapEnd(boxes, { x: 600, y: 600 }, 1)).toEqual({ end: { x: 600, y: 600 }, mark: null });
  });

  it('snaps within 12 screen pixels of a box, to the side nearest the pointer', () => {
    // 8 px right of the front box (its right edge is x 130): the right side.
    const snap = snapEnd(boxes, { x: 138, y: 40 }, 1);
    expect(snap.end).toEqual({ item: 'front', side: 'right' });
    expect(snap.mark).toEqual({ x: 130, y: 40 });
    // Not at 14.
    expect(snapEnd(boxes, { x: 144, y: 40 }, 1).end).toEqual({ x: 144, y: 40 });
    // The reach is in screen pixels: at 200% 12 px is 6 units.
    expect(snapEnd(boxes, { x: 138, y: 40 }, 2).end).toEqual({ x: 138, y: 40 });
  });

  it('picks top, bottom and left by where the pointer is', () => {
    const alone = [{ id: 'only', box: box(100, 100) }];
    expect(snapEnd(alone, { x: 150, y: 94 }, 1).end).toEqual({ item: 'only', side: 'top' });
    expect(snapEnd(alone, { x: 150, y: 166 }, 1).end).toEqual({ item: 'only', side: 'bottom' });
    expect(snapEnd(alone, { x: 94, y: 130 }, 1).end).toEqual({ item: 'only', side: 'left' });
  });

  it('attaches auto over the middle third', () => {
    const snap = snapEnd(boxes, { x: 82, y: 42 }, 1);
    expect(snap.end).toEqual({ item: 'front', side: 'auto' });
    expect(snap.mark).toEqual({ x: 80, y: 40 });
  });

  it('prefers the topmost item where boxes overlap, and skips the item it is told to', () => {
    expect(snapEnd(boxes, { x: 60, y: 30 }, 1).end).toMatchObject({ item: 'front' });
    expect(snapEnd(boxes, { x: 60, y: 30 }, 1, 'front').end).toMatchObject({ item: 'back' });
  });

  it('snaps to a turned box by its own sides', () => {
    const turned = [{ id: 'turned', box: box(0, 0, 90) }];
    // Turned a quarter, the box is 60 wide and 100 tall; its top side is where the left one was, to the right.
    expect(snapEnd(turned, { x: 50, y: 88 }, 1).end).toEqual({ item: 'turned', side: 'right' });
  });
});

describe('auto sides and arrowhead trimming', () => {
  it('aims an auto side at the other end’s fixed side, not at its middle', () => {
    // A tall box beside a short one: the auto end faces the other's top side (above its middle), so it leaves by the top.
    const tall: Geometry = { x: 0, y: 0, width: 100, height: 60, rotation: 0 };
    const other: Geometry = { x: 40, y: -400, width: 100, height: 600, rotation: 0 };
    const toMiddle = routeBetween(at(tall, 'auto'), at(other, 'auto'), 'straight');
    // Both auto: each faces the other's middle.
    near(pt(toMiddle, 0), sideMidpoint(tall, 'top'));
    const toTop = routeBetween(at(tall, 'auto'), at(other, 'top'), 'straight');
    near(pt(toTop, 1), sideMidpoint(other, 'top'));
    near(pt(toTop, 0), sideMidpoint(tall, 'top'));
    const toBottomSide = routeBetween(at(tall, 'auto'), at(other, 'bottom'), 'straight');
    near(pt(toBottomSide, 0), sideMidpoint(tall, 'bottom'));
  });

  it('shortens a line and a curve under an arrowhead by the head’s length, and never past the middle', () => {
    const line = routeBetween(at(left, 'right'), at(right, 'left'), 'straight');
    const short = trimmed(line, 10, 10);
    expect(points(short)).toEqual([{ x: 110, y: 30 }, { x: 290, y: 30 }]);
    expect(points(trimmed(line, 1000, 0))[0]?.x).toBeCloseTo(100 + 200 * 0.45, 5);
    const curve = routeBetween(at(left, 'right'), at(right, 'left'), 'curved');
    const cut = trimmed(curve, 0, 12);
    expect(cut.kind).toBe('curve');
    const end = pt(cut, -1);
    expect(Math.hypot(end.x - 300, end.y - 30)).toBeGreaterThan(10);
    expect(Math.hypot(end.x - 300, end.y - 30)).toBeLessThan(14);
    near(pt(cut, 0), { x: 100, y: 30 });
  });
});

describe('the cost of an elbow', () => {
  const average = (from: Anchor, to: Anchor): number => {
    routeBetween(from, to, 'elbow');
    const start = performance.now();
    for (let i = 0; i < 200; i += 1) routeBetween(from, to, 'elbow');
    return (performance.now() - start) / 200;
  };

  it('is well under 2 ms a route when an end is buried in the other box and when it takes five segments', () => {
    const buried = average(at(box(0, 0), 'right'), at(box(60, 20, 30), 'left'));
    const behind = average(at(box(0, 0), 'right'), at(box(-300, 10), 'left'));
    console.info(`elbow routes, mean per call: buried ${buried.toFixed(3)} ms, behind ${behind.toFixed(3)} ms`);
    expect(buried).toBeLessThan(2);
    expect(behind).toBeLessThan(2);
  });

  it('gives a straight line at once for an end buried in the other box', () => {
    const path = routeBetween(at(box(0, 0), 'right'), at(box(60, 20, 30), 'left'), 'elbow');
    expect(segmentCount(path)).toBe(1);
  });
});
