import type { KeyboardEvent } from 'react';

/** Arrow, Home and End keys inside a tab list or radio group, wrapping at the ends. */
export function rovingIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Moves focus and selection together, the way native radio buttons behave, so one Tab stop covers the group.
 * Returns the new index, or null when the key isn't a navigation key.
 */
export function roveFocus(
  event: KeyboardEvent<HTMLElement>,
  current: number,
  count: number,
  itemSelector: string,
): number | null {
  const next = rovingIndex(event.key, current, count);
  if (next === null) return null;
  event.preventDefault();
  const group = event.currentTarget.parentElement;
  group?.querySelectorAll<HTMLElement>(itemSelector)[next]?.focus();
  return next;
}
