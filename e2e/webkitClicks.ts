import type { Page } from '@playwright/test';

/**
 * Makes a Chromium page press buttons as a Mac's WebKit does (6.19): a mousedown on a button, a summary or a link gives
 * it no focus and takes focus away from what had it, unless the page prevented the mousedown's default. Text fields and
 * other mouse-focusable elements keep Chromium's own behaviour. Chromium-only runs can then cover what only the Mac's
 * engine showed: a menu closing on that blur, a clicked button that never takes focus.
 */
export async function pressLikeWebKit(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener('mousedown', (event) => {
      // In the bubble phase on the window: after the page's own handlers, which may have prevented it already.
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      if (!event.target.closest('button, [role="button"], summary, a[href]')) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  });
}
