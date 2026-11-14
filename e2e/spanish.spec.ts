import { expect, test, type Page } from '@playwright/test';
import { SETTINGS_KEY } from '../src/core/storage/settings';

// Latin American Spanish (polish 7) in the memory build: every screen in Spanish, and no word cut off or spilling out
// of a button, a tab, a label or a tile's title bar, longer as Spanish runs than English.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate((key) => {
    window.localStorage.clear();
    window.localStorage.setItem(key, JSON.stringify({ language: 'es' }));
  }, SETTINGS_KEY);
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('El Condado'));
  await page.getByRole('button', { name: 'Nuevo proyecto…' }).click();
  await page.getByRole('dialog', { name: /^Configurar / }).getByRole('button', { name: 'Saltar' }).click();
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Secciones' });
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });

/**
 * The app's words that don't fit: an element wider inside than its box (cut off with …, or spilling), or one that
 * reaches past the nearest box that clips it (a title bar pushing its buttons out of the tile, an inline label running
 * off a panel). Title bars are checked as a whole, since a long title widens the bar, not itself.
 */
async function overflowing(page: Page, within?: string): Promise<string[]> {
  return page.evaluate((root) => {
    const selector = [
      'button',
      '[role="tab"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="columnheader"]',
      '[role="rowheader"]',
      '[role="menuitem"]',
      'label',
      'th',
      '.sb-label',
      'span.truncate',
      '.h-titlebar',
      'h1',
      'h2',
      'summary',
    ].join(', ');
    const clipper = (el: HTMLElement): HTMLElement | null => {
      for (let at = el.parentElement; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.overflowX !== 'visible') return at;
      }
      return null;
    };
    const out: string[] = [];
    const scope = root ? document.querySelector(root) : document;
    for (const el of scope?.querySelectorAll<HTMLElement>(selector) ?? []) {
      // Hidden, or the person's own text (a scene's name), which is theirs to shorten.
      if (el.getClientRects().length === 0 || el.closest('[data-user-text]')) continue;
      const box = el.getBoundingClientRect();
      // Visually hidden for screen readers only (1px by design).
      if (box.width <= 1 || box.height <= 1) continue;
      const text = el.textContent.trim();
      if (text === '') continue;
      const name = `${el.tagName.toLowerCase()} “${text.slice(0, 60)}”`;
      if (el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1) out.push(`${name} ${String(el.scrollWidth)}>${String(el.clientWidth)}`);
      const clip = clipper(el);
      // A box that scrolls (a tile's body, the shot list) shows the rest by scrolling: only what's clipped for good counts.
      if (clip && getComputedStyle(clip).overflowX !== 'auto' && getComputedStyle(clip).overflowX !== 'scroll') {
        const edge = clip.getBoundingClientRect();
        if (box.right > edge.right + 1 || box.left < edge.left - 1) out.push(`${name} past its ${clip.tagName.toLowerCase()}`);
      }
    }
    return [...new Set(out)];
  }, within);
}

test('every screen is in Spanish, and the document says so', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-419');
  await expect(sidebar(page).getByRole('button', { name: /^Storyboard/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Escenas', exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Escenas', exact: true }).getByRole('button', { name: '+ Escena nueva' }).click();
  await board(page).getByRole('button', { name: '+ Cuadro en ESC 01' }).click();
  await board(page).locator('[data-shot-id]').first().click();
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  // Shot sizes in Spanish abbreviations; stored values stay as they are.
  await inspector.getByRole('radio', { name: 'PG', exact: true }).click();
  await expect(board(page).locator('[data-shot-id]').first()).toContainText('PG');
  await expect(inspector.getByRole('grid', { name: 'Departamentos de este cuadro' })).toBeVisible();
});

test('nothing the app says spills out of its box, in any workspace, menu or window', async ({ page }) => {
  const scenes = page.getByRole('region', { name: 'Escenas', exact: true });
  await scenes.getByRole('button', { name: '+ Escena nueva' }).click();
  for (let i = 0; i < 2; i += 1) await board(page).getByRole('button', { name: '+ Cuadro en ESC 01' }).click();
  await board(page).locator('[data-shot-id]').first().click();
  const seen: string[] = [];
  const check = async (where: string, within?: string) => {
    for (const problem of await overflowing(page, within)) seen.push(`${where}: ${problem}`);
  };
  await check('Storyboard');
  await board(page).getByRole('radio', { name: 'Lista de planos' }).click();
  await check('Lista de planos');
  for (const section of ['Recursos', 'Equipo', 'Planta', 'Producción', 'Moodboard']) {
    await sidebar(page).getByRole('button', { name: new RegExp(`^${section}`) }).click();
    await check(section);
  }
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await page.getByRole('button', { name: /^Disposición/ }).click();
  await check('Menú Disposición');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await check('Menú Proyecto');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Configuración \(/ }).click();
  const settings = page.getByRole('dialog', { name: 'Configuración' });
  for (const tab of ['Proyecto', 'App', 'Tema', 'Respaldos', 'Almacenamiento', 'Perfil']) {
    await settings.getByRole('tab', { name: tab, exact: true }).click();
    await check(`Configuración → ${tab}`);
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Exportar proyecto…' }).click();
  await check('Exportar');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Proyecto', exact: true }).click();
  await page.getByRole('button', { name: 'Configuración de marca de agua…' }).click();
  await check('Marca de agua');
  await page.keyboard.press('Escape');

  // The department grid with states ticked, and the scene's own inspector with its palette.
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  const grid = inspector.getByRole('grid', { name: 'Departamentos de este cuadro' });
  for (const name of ['Cámara: Prioridad', 'Cámara: En proceso', 'Maquillaje y peinado: Listo', 'Grip y eléctricos: Prioridad']) {
    await grid.getByRole('checkbox', { name, exact: true }).click();
  }
  await check('Departamentos');
  await scenes.getByRole('list', { name: 'Escenas' }).locator('[data-scene-row]').first().click();
  await check('Inspector de escena');

  // Tiles any workspace can open, one at a time, each checked on its own and closed again, so opening them doesn't
  // squeeze the workspace's other tiles to slivers no language fits.
  for (const tile of ['Historial', 'Papelera', 'Guion de color']) {
    await page.getByRole('button', { name: /^Disposición/ }).click();
    // The menu's item, not the top bar's History button of the same name: the menu comes after it.
    await page.getByRole('button', { name: tile, exact: true }).last().click();
    const region = page.getByRole('region', { name: tile, exact: true });
    await expect(region).toBeVisible();
    await check(tile, `section[aria-label="${tile}"]`);
    await region.getByRole('button', { name: `Cerrar ${tile}` }).click();
  }
  expect(seen).toEqual([]);
});
