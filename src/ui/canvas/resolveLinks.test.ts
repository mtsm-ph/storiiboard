import { describe, expect, it } from 'vitest';
import { resolveLinks, type ResolveInput, type RouteEntry } from './resolveLinks';
import type { CanvasItem, CanvasLink } from './types';

// The connectors as drawn (5.2, 5.7): the same objects while nothing they depend on changed, new ones when it did.

const item = (id: string, x: number, y = 0): CanvasItem => ({ id, label: id, x, y, width: 100, height: 60, rotation: 0 });
const link = (over: Partial<CanvasLink> = {}): CanvasLink => ({
  id: 'l1',
  label: 'Connector',
  from: { item: 'a', side: 'right' },
  to: { item: 'b', side: 'left' },
  route: 'straight',
  startHead: 'none',
  endHead: 'arrow',
  color: null,
  width: 1.5,
  text: '',
  ...over,
});

function run(over: Partial<ResolveInput>, routes: Map<string, RouteEntry>) {
  const items = over.items ?? [item('a', 0), item('b', 300)];
  return resolveLinks({ links: [link()], items, shown: items, draft: null, connecting: null, editing: null, liveBoxes: null, routes, ...over });
}

describe('the resolved connectors', () => {
  it('are the same objects while nothing they depend on changed, whatever moves elsewhere', () => {
    const routes = new Map<string, RouteEntry>();
    const links = [link()];
    const items = [item('a', 0), item('b', 300), item('c', 900)];
    const first = run({ links, items }, routes);
    const moved = [items[0] as CanvasItem, items[1] as CanvasItem, item('c', 950)];
    const second = run({ links, items: moved }, routes);
    expect(second[0]).toBe(first[0]);
  });

  it('are routed again when an end item moves', () => {
    const routes = new Map<string, RouteEntry>();
    const links = [link()];
    const first = run({ links, items: [item('a', 0), item('b', 300)] }, routes);
    const second = run({ links, items: [item('a', 0), item('b', 300, 200)] }, routes);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]?.path.points.at(-1)).not.toEqual(first[0]?.path.points.at(-1));
  });

  it('are new objects when the connector itself changed (its words, say) and when it is being typed into', () => {
    const routes = new Map<string, RouteEntry>();
    const items = [item('a', 0), item('b', 300)];
    const first = run({ links: [link()], items }, routes);
    const worded = run({ links: [link({ text: 'cut to' })], items }, routes);
    expect(worded[0]).not.toBe(first[0]);
    expect(worded[0]?.patch).not.toBeNull();
    const typing = run({ links: [link({ text: 'cut to' })], items, editing: 'l1' }, routes);
    expect(typing[0]).not.toBe(worded[0]);
  });

  it('leave out a connector whose item has gone, and forget connectors that are no longer on the board', () => {
    const routes = new Map<string, RouteEntry>();
    const items = [item('a', 0), item('b', 300)];
    expect(run({ links: [link(), link({ id: 'l2', to: { item: 'gone', side: 'left' } })], items }, routes)).toHaveLength(1);
    run({ links: [link(), link({ id: 'l3' })], items }, routes);
    expect([...routes.keys()].sort()).toEqual(['l1', 'l3']);
    run({ links: [], items }, routes);
    expect(routes.size).toBe(0);
  });
});
