// The guard round a delete-for-good (1.21: Empty Trash, Clean up old pictures), kept apart from the tiles so it's
// tested on its own: a confirm is async in the desktop app, and the project can change while it's up.

export type ForGood<T> = { ran: true; result: T } | { ran: false; why: 'busy' | 'cancelled' | 'switched' };

/**
 * Asks, then runs `work` only if the answer is yes and `stillOpen()` says the project the confirm was about is still
 * the open one. One run at a time per `running`: a second click while the confirm or the work is under way does
 * nothing. The button is never disabled meanwhile, so a Cancel leaves keyboard focus where it was.
 */
export async function forGood<T>(
  running: { current: boolean },
  ask: () => Promise<boolean>,
  stillOpen: () => boolean,
  work: () => Promise<T>,
): Promise<ForGood<T>> {
  if (running.current) return { ran: false, why: 'busy' };
  running.current = true;
  try {
    if (!(await ask())) return { ran: false, why: 'cancelled' };
    if (!stillOpen()) return { ran: false, why: 'switched' };
    return { ran: true, result: await work() };
  } finally {
    running.current = false;
  }
}

export const SWITCHED_MESSAGE = 'Another project opened while you were deciding, so nothing was deleted.';
