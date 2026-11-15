import type { Page } from '@playwright/test';

/**
 * Makes a Chromium page press buttons as a Mac's WebKit does (6.19): a mousedown on a button, a summary or a link gives
 * it no focus, unless the page prevented the mousedown's default. Focus goes where WebKit sends it instead (6.19b): to
 * the nearest ancestor that a mouse can focus (one with a tabindex, as a workspace panel has), or, with none, to
 * nothing, taken from what had it. Text fields and other mouse-focusable elements keep Chromium's own behaviour.
 * Chromium-only runs can then cover what only the Mac's engine showed: a menu or a panel closing on that blur, a
 * clicked button that never takes focus.
 */
export async function pressLikeWebKit(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener('mousedown', (event) => {
      // In the bubble phase on the window: after the page's own handlers, which may have prevented it already.
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const pressed = event.target.closest('button, [role="button"], summary, a[href]');
      if (!pressed) return;
      event.preventDefault();
      const holder = pressed.parentElement?.closest<HTMLElement>('[tabindex], [contenteditable]:not([contenteditable="false"])');
      if (holder && !holder.closest('[inert]')) {
        if (holder !== document.activeElement) holder.focus({ preventScroll: true });
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
  });
}
