import { describe, expect, it } from 'vitest';
import { createTileQueue, TileDropped } from './tileQueue';

// The page's queue for map tiles (4.9): at most 2 out, nothing no longer in view is asked for, newest view first.

interface Call {
  key: string;
  finish: (value: string) => void;
  fail: (reason: unknown) => void;
}

function rig(limit = 2) {
  const calls: Call[] = [];
  const queue = createTileQueue<string>(
    (z, x, y) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ key: `${String(z)}/${String(x)}/${String(y)}`, finish: resolve, fail: reject });
      }),
    limit,
    300,
    30_000,
  );
  return { calls, queue };
}

const view = (zoom: number, count: number) => Array.from({ length: count }, (_, x) => ({ z: zoom, x, y: 0 }));
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the tile queue', () => {
  it('has at most 2 asked at once, and the rest wait', async () => {
    const { calls, queue } = rig();
    const tiles = view(16, 6);
    queue.want(tiles);
    const got = tiles.map((tile) => queue.get(tile.z, tile.x, tile.y));
    expect(calls).toHaveLength(2);
    expect(queue.stats()).toEqual({ outstanding: 2, waiting: 4 });
    calls[0]?.finish('a');
    await settle();
    expect(calls).toHaveLength(3);
    expect(queue.stats().outstanding).toBe(2);
    expect(await got[0]).toBe('a');
  });

  it('drops what is no longer in view before it is asked for', async () => {
    const { calls, queue } = rig();
    const old = view(16, 6);
    queue.want(old);
    const dropped = old.map((tile) => queue.get(tile.z, tile.x, tile.y).then(() => 'ok', (e: unknown) => (e instanceof TileDropped ? 'dropped' : 'failed')));
    expect(calls).toHaveLength(2);
    // The view changes (a zoom): the 4 waiting are of a view left.
    const next = view(17, 2);
    queue.want(next);
    for (const tile of next) void queue.get(tile.z, tile.x, tile.y);
    expect(await Promise.all(dropped.slice(2))).toEqual(['dropped', 'dropped', 'dropped', 'dropped']);
    // The two already out finish; then only the new view's tiles are asked for, never the dropped ones.
    calls[0]?.finish('x');
    calls[1]?.finish('y');
    await settle();
    expect(calls.map((c) => c.key)).toEqual(['16/0/0', '16/1/0', '17/1/0', '17/0/0']);
    expect(queue.stats().waiting).toBe(0);
  });

  it('serves the newest asked for first', async () => {
    const { calls, queue } = rig(1);
    const tiles = view(16, 4);
    queue.want(tiles);
    for (const tile of tiles) void queue.get(tile.z, tile.x, tile.y);
    calls[0]?.finish('first');
    await settle();
    expect(calls.map((c) => c.key)).toEqual(['16/0/0', '16/3/0']);
  });

  it('holds a tile it has, and asks again for one that failed only after a while', async () => {
    const { calls, queue } = rig();
    queue.want([{ z: 3, x: 1, y: 1 }]);
    const first = queue.get(3, 1, 1);
    expect(queue.get(3, 1, 1)).toBe(first);
    calls[0]?.finish('picture');
    expect(await first).toBe('picture');
    expect(queue.get(3, 1, 1)).toBe(first);
    expect(calls).toHaveLength(1);
    // A failure is remembered, so a pan doesn't ask again at once.
    queue.want([{ z: 3, x: 2, y: 2 }]);
    const failing = queue.get(3, 2, 2);
    calls[1]?.fail(new Error('offline'));
    await expect(failing).rejects.toThrow('offline');
    expect(queue.get(3, 2, 2)).toBe(failing);
    expect(calls).toHaveLength(2);
  });

  it('forgets everything held and drops what waits', async () => {
    const { calls, queue } = rig(1);
    queue.want(view(5, 3));
    const all = view(5, 3).map((tile) => queue.get(tile.z, tile.x, tile.y).catch((e: unknown) => (e instanceof TileDropped ? 'dropped' : 'failed')));
    queue.forget();
    expect(await Promise.all(all.slice(1))).toEqual(['dropped', 'dropped']);
    calls[0]?.finish('late');
    await settle();
    expect(calls).toHaveLength(1);
  });
});
