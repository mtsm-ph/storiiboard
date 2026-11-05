import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';

// Screenshot tests (on again from polish 8): three screens, in both themes and both languages. Baselines are per
// browser and per OS (fonts render differently), so each platform keeps its own set: win32 from the Windows gate,
// darwin and linux from the Checkpoint workflow (a push to checkpoint/baselines-<anything> regenerates them).
test.use({ viewport: { width: 1440, height: 900 } });

const LANGUAGES = {
  en: { newProject: 'New project…', setUp: /^Set up /, skip: 'Skip', scenes: 'Scenes', newScene: '+ New scene', frameIn: '+ Frame in SC', settings: /^Settings \(/ },
  es: { newProject: 'Nuevo proyecto…', setUp: /^Configurar /, skip: 'Saltar', scenes: 'Escenas', newScene: '+ Escena nueva', frameIn: '+ Cuadro en ESC', settings: /^Configuración \(/ },
} as const;
type Language = keyof typeof LANGUAGES;

/** Opens the app fresh in a theme and a language: settings cleared, then the language saved as Settings would. */
async function start(page: Page, scheme: 'light' | 'dark', language: Language, path: string): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto(path);
  await page.evaluate(
    ([key, lang]) => {
      window.localStorage.clear();
      if (lang !== 'en') window.localStorage.setItem(key, JSON.stringify({ language: lang }));
    },
    [SETTINGS_KEY, language] as const,
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
}

/** A project with two scenes, four frames and the second frame selected, so the inspector shows a frame. */
async function boardWithFrames(page: Page, language: Language): Promise<void> {
  const words = LANGUAGES[language];
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: words.newProject }).click();
  await page.getByRole('dialog', { name: words.setUp }).getByRole('button', { name: words.skip }).click();
  const scenes = page.getByRole('region', { name: words.scenes, exact: true });
  await scenes.getByRole('button', { name: words.newScene }).click();
  await scenes.getByRole('button', { name: words.newScene }).click();
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  for (let i = 0; i < 3; i += 1) await board.getByRole('button', { name: `${words.frameIn} 01` }).click();
  await board.getByRole('button', { name: `${words.frameIn} 02` }).click();
  await board.locator('[data-shot-id]').nth(1).click();
}

/** Nothing focused (the picture shows the selection, not a focus ring) and the fonts loaded. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    // Adding SC 02's frame scrolled the board to keep it in view: back to the top, on the nearest box that scrolls.
    let scroller = document.querySelector('[data-board]')?.parentElement ?? null;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    scroller?.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

for (const language of ['en', 'es'] as const) {
  // English keeps the names its baselines had before Spanish, so regenerating them replaces the old files.
  const suffix = language === 'en' ? '' : `-${language}`;
  for (const scheme of ['light', 'dark'] as const) {
    test(`shell, ${scheme}, ${language}`, async ({ page }) => {
      await start(page, scheme, language, '/');
      await settle(page);
      await expect(page).toHaveScreenshot(`shell-${scheme}${suffix}.png`, { animations: 'disabled' });
    });

    // The board with a project open (the memory build): scene groups, frame cards, a selected frame and its
    // inspector, so a change to how frames, the department grid or the palette draw shows up here.
    test(`board, ${scheme}, ${language}`, async ({ page }) => {
      await start(page, scheme, language, '/?files=memory');
      await boardWithFrames(page, language);
      await settle(page);
      await expect(page).toHaveScreenshot(`board-${scheme}${suffix}.png`, { animations: 'disabled' });
    });

    // An in-app window over the board: Settings on its App tab (the same in every project, no paths or sizes).
    test(`settings, ${scheme}, ${language}`, async ({ page }) => {
      await start(page, scheme, language, '/?files=memory');
      await boardWithFrames(page, language);
      // The sidebar's gear, not ⌘,: Chromium on a Mac keeps ⌘, for itself.
      await page.getByRole('button', { name: LANGUAGES[language].settings }).click();
      const settings = page.getByRole('dialog').last();
      await expect(settings).toBeVisible();
      await settings.getByRole('tab', { name: 'App', exact: true }).click();
      await settle(page);
      await expect(page).toHaveScreenshot(`settings-${scheme}${suffix}.png`, { animations: 'disabled' });
    });
  }
}
