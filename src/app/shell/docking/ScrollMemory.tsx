import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useProject } from '../../projectStore';

// Where each tile's content was scrolled to, kept as people scroll and put back when the tile is drawn again (P4's
// low). Docking a tile along the top or the bottom wraps the whole workspace in a new split, which React draws afresh,
// so every tile would otherwise start again at the top: the board, History, the shot list.

/** Per project and tile, each scrolled element's position, by its place under the tile's content (child indices). */
const memory = new Map<string, Map<string, { top: number; left: number }>>();

function pathFrom(root: Element, element: Element): string | null {
  const steps: number[] = [];
  let node: Element = element;
  while (node !== root) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    steps.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return steps.join('.');
}

function elementAt(root: Element, path: string): Element | null {
  let node: Element | null = root;
  for (const step of path === '' ? [] : path.split('.')) node = node?.children[Number(step)] ?? null;
  return node;
}

/** Wraps a tile's content without a box of its own (display: contents), so the tile's layout is unchanged. */
export function ScrollMemory({ tile, children }: { tile: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Another project's board is another board: never put back where a different one was scrolled.
  const key = `${useProject((s) => s.project?.file.path) ?? ''}\n${tile}`;
  useLayoutEffect(() => {
    // From the tile itself: its body, round the content, is often what scrolls (the board's is).
    const root = ref.current?.closest('section') ?? ref.current;
    if (!root) return;
    // Drawn again: back where it was, element by element, for what's there in the same place. Content that lays itself
    // out after a frame or two (the board measures its width first) is shorter than that at first and clamps the
    // position, so it's tried again each frame, for half a second at most, until it holds.
    let pending = [...(memory.get(key) ?? [])];
    let frames = 0;
    let request = 0;
    const settle = () => {
      pending = pending.filter(([path, { top, left }]) => {
        const element = elementAt(root, path);
        if (!element) return false;
        element.scrollTop = top;
        element.scrollLeft = left;
        return Math.abs(element.scrollTop - top) > 1 || Math.abs(element.scrollLeft - left) > 1;
      });
      frames += 1;
      if (pending.length > 0 && frames < 30) request = requestAnimationFrame(settle);
    };
    settle();
    // Scroll events don't bubble, so this listens in the capture phase.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const path = pathFrom(root, event.target);
      if (path === null) return;
      const kept = memory.get(key) ?? new Map<string, { top: number; left: number }>();
      kept.set(path, { top: event.target.scrollTop, left: event.target.scrollLeft });
      memory.set(key, kept);
    };
    // A person scrolling or pressing a key meanwhile has the last word.
    const stop = () => {
      pending = [];
    };
    root.addEventListener('scroll', onScroll, true);
    root.addEventListener('wheel', stop, { capture: true, passive: true });
    root.addEventListener('pointerdown', stop, true);
    root.addEventListener('keydown', stop, true);
    return () => {
      cancelAnimationFrame(request);
      root.removeEventListener('scroll', onScroll, true);
      root.removeEventListener('wheel', stop, true);
      root.removeEventListener('pointerdown', stop, true);
      root.removeEventListener('keydown', stop, true);
    };
  }, [key]);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
