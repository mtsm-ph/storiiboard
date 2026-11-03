import type { KeyboardEvent } from 'react';

const ITEM = '[data-nav-item]:not(:disabled)';

/** Up and Down (and Home, End) walk the sidebar's entries in order, sections and scenes alike. */
export function onNavKeyDown(event: KeyboardEvent<HTMLElement>) {
  const items = [...(event.currentTarget.closest('nav')?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
  const current = items.indexOf(event.currentTarget);
  if (current === -1) return;
  const last = items.length - 1;
  const next = { ArrowDown: Math.min(current + 1, last), ArrowUp: Math.max(current - 1, 0), Home: 0, End: last }[
    event.key
  ];
  if (next === undefined) return;
  event.preventDefault();
  items[next]?.focus();
}
