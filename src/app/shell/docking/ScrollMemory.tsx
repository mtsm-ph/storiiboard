import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useProject } from '../../projectStore';

// Where each tile's content was scrolled to, kept as people scroll and put back when the tile is drawn again (P4's
// low). Docking a tile along the top or the bottom wraps the whole workspace in a new split, which React draws afresh,
// so every tile would otherwise start again at the top: the board, History, the shot list.
//
// The memory belongs to one Dock, the workspace on screen: switching workspaces draws a new Dock and starts clean, so
// the board opens on the active scene as it always has, and nothing here ever overrides that.

type Positions = Map<string, Map<string, { top: number; left: number }>>;

const Memory = createContext<Positions | null>(null);

/** One workspace's memory, for as long as its Dock is on screen. */
export function ScrollMemoryScope({ children }: { children: ReactNode }) {
  const [memory] = useState<Positions>(() => new Map());
  return <Memory.Provider value={memory}>{children}</Memory.Provider>;
}

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
  const memory = useContext(Memory);
  const ref = useRef<HTMLDivElement>(null);
  // Another project's board is another board: never put back where a different one was scrolled.
  const key = `${useProject((s) => s.project?.file.path) ?? ''}\n${tile}`;
  useLayoutEffect(() => {
    // From the tile itself: its body, round the content, is often what scrolls (the board's is).
    const root = ref.current?.closest('section') ?? ref.current;
    if (!memory || !root) return;
    // Drawn again: back where it was, element by element. Content that lays itself out after a frame or two (the
    // board measures its width first) clamps the position at first, so it's tried again each frame, for half a second
    // at most. What this writes is remembered, so its own scroll events aren't taken for the person's.
    const pending = new Map(memory.get(key) ?? []);
    const written = new Map<string, { top: number; left: number }>();
    let frames = 0;
    let request = 0;
    const settle = () => {
      for (const [path, { top, left }] of pending) {
        const element = elementAt(root, path);
        if (!element) {
          pending.delete(path);
          continue;
        }
        element.scrollTop = top;
        element.scrollLeft = left;
        written.set(path, { top: element.scrollTop, left: element.scrollLeft });
        if (Math.abs(element.scrollTop - top) <= 1 && Math.abs(element.scrollLeft - left) <= 1) pending.delete(path);
      }
      frames += 1;
      if (pending.size > 0 && frames < 30) request = requestAnimationFrame(settle);
    };
    settle();
    // Scroll events don't bubble, so this listens in the capture phase.
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const path = pathFrom(root, event.target);
      if (path === null) return;
      const at = { top: event.target.scrollTop, left: event.target.scrollLeft };
      const ours = written.get(path);
      // The restore's own write (even one the content clamped) isn't a position to keep; anything else is, and it
      // ends the restore there: the app bringing a scene into view, or the person, has the last word.
      if (ours && ours.top === at.top && ours.left === at.left) return;
      pending.delete(path);
      written.delete(path);
      const kept = memory.get(key) ?? new Map<string, { top: number; left: number }>();
      kept.set(path, at);
      memory.set(key, kept);
    };
    const stop = () => {
      pending.clear();
      written.clear();
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
  }, [key, memory]);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
