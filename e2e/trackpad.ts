import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Turns trackpad mode on (6.5.3) through the switch by the open canvas's zoom, for a test of the wheel as it always was:
 * two fingers pan, Ctrl or a pinch zooms. Off by default on Windows and Linux, so a test written for that behaviour sets
 * it first. The click is sent to the switch without moving focus, so whatever the test had focused keeps it.
 */
export async function trackpadModeOn(scope: Page | Locator): Promise<void> {
  const control = scope.getByRole('switch', { name: 'Trackpad mode' }).first();
  if ((await control.getAttribute('aria-checked')) !== 'true') await control.dispatchEvent('click');
  await expect(control).toHaveAttribute('aria-checked', 'true');
}
