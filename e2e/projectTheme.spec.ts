import { expect, test, type Page } from '@playwright/test';

// A project's own theme (1.15): its tokens go on <html> and ease in over 200ms with no reload, Follow project takes its
// mode, reduced motion switches at once, and a project without one shows the kit. Onboarding and Settings → Theme
// (1.16) write the prop; here the test writes it through the app's own store, as they will.

async function newProject(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept(name));
  await page.getByRole('button', { name: 'New project…' }).click();
  await expect(page.getByRole('region', { name: 'Storyboard workspace' })).toBeVisible();
}

/** Writes a generated theme into the open project's record, through an op as Settings will. */
function setProjectTheme(page: Page, accent: string, mode: 'light' | 'dark') {
  return page.evaluate(
    async ({ accent, mode }) => {
      const [{ themeFor }, { themeProp }, { projectStore }] = await Promise.all([
        import(/* @vite-ignore */ '/src/ui/theme/generator/generate.ts') as Promise<typeof import('../src/ui/theme/generator/generate')>,
        import(/* @vite-ignore */ '/src/ui/theme/projectTheme.ts') as Promise<typeof import('../src/ui/theme/projectTheme')>,
        import(/* @vite-ignore */ '/src/app/projectStore.ts') as Promise<typeof import('../src/app/projectStore')>,
      ]);
      const { project, apply } = projectStore.getState();
      if (!project) throw new Error('no project open');
      const theme = themeFor(accent);
      await apply([{ kind: 'update', id: project.projectId, set: { theme: themeProp(theme, { source: 'manual', mode, imageId: null, candidates: [] }) } }]);
      // Looked for frame by frame in the page itself, so a slow test machine can't miss the 200ms: whether the
      // background eased (a CSS transition ran on --bg) rather than jumped.
      const eased = await new Promise<boolean>((resolve) => {
        const started = performance.now();
        const look = () => {
          const easing = document.documentElement
            .getAnimations()
            .some((a) => a instanceof CSSTransition && a.transitionProperty === '--bg');
          if (easing || performance.now() - started > 400) resolve(easing);
          else requestAnimationFrame(look);
        };
        look();
      });
      return { theme, eased };
    },
    { accent, mode },
  );
}

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());

/** sRGB hex as getComputedStyle reports a registered colour: rgb(r, g, b). */
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

test('a project’s theme eases in without a reload, and Follow project takes its mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await newProject(page, 'Bey County');
  const { theme, eased } = await setProjectTheme(page, '#1E6BD6', 'dark');
  expect(eased).toBe(true);
  // Follow project is the default, so the project's dark mode shows.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => background(page)).toBe(rgb(theme.dark.bg));
  await expect(page.locator('html')).toHaveCSS('--accent', rgb(theme.dark.accent));

  // A fixed choice in the status bar wins over the project's mode.
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => background(page)).toBe(rgb(theme.light.bg));
});

test('with reduced motion the theme switches at once, and a project without one shows the kit', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await newProject(page, 'Bey County');
  const kit = await background(page);
  const { theme, eased } = await setProjectTheme(page, '#2E8B57', 'light');
  // No easing at all.
  expect(eased).toBe(false);
  await expect.poll(() => background(page)).toBe(rgb(theme.light.bg));

  // The kit again once the theme goes (undo), with no reload.
  await page.keyboard.press(/Mac/i.test(await page.evaluate(() => navigator.userAgent)) ? 'Meta+z' : 'Control+z');
  await expect.poll(() => background(page)).toBe(kit);
  await expect(page.locator('html')).not.toHaveAttribute('style', /--bg/);
});
