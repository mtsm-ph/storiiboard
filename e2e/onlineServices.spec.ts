import { expect, test } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { openSettings } from './settings';

// Settings → Online services (4.0): in a browser build the service switch is never read, so every state is "Not
// checked yet".
test('lists the address search and the weather with their servers and "Not checked yet"', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  const panel = await openSettings(page, 'Online services');
  const nominatim = panel.locator('[data-service="nominatim"]');
  await expect(nominatim).toContainText('Address search');
  await expect(nominatim).toContainText('Only when you press Search address.');
  await expect(nominatim).toContainText('https://nominatim.openstreetmap.org');
  await expect(nominatim).toContainText('Not checked yet');
  const weather = panel.locator('[data-service="met-norway"]');
  await expect(weather).toContainText('Weather (MET Norway)');
  await expect(weather).toContainText('The forecast for each location on a call sheet.');
  await expect(weather).toContainText('https://api.met.no/weatherapi/locationforecast/2.0');
  await expect(weather).toContainText('Not checked yet');
  await expect(panel.locator('[data-service]')).toHaveCount(2);
  await expect(panel).toContainText('at most once a day');
});
