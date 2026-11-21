import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ASSISTANT_TOOLS } from '../src/core/model/assistantTools';
import { skipOnboarding } from './onboarding';
import { applySettings, closeSettings, openSettings } from './settings';

// Settings → AI assistant (7.6, Phase 7 decision 14): every tool of the MCP server's one list with its line, in English
// and Spanish; what the assistant can suggest, from the scope row; that stored contact details are never read; and
// where its change files go. Axe, light and dark. Made-up projects only.

async function fresh(page: Page) {
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Harbor Lights'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
}

test('lists every tool with its line, what the assistant can suggest, and that contact details are never read', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(page);
  const panel = await openSettings(page, 'AI assistant');
  await expect(panel.locator('[data-assistant-tool]')).toHaveCount(ASSISTANT_TOOLS.length);
  for (const tool of ASSISTANT_TOOLS) await expect(panel.locator(`[data-assistant-tool="${tool.name}"]`)).toContainText(tool.name);
  await expect(panel.locator('[data-assistant-tool="get_plan"]')).toContainText('A setup’s bird’s-eye plan in metres');
  await expect(panel.locator('[data-assistant-tool="suggest_trash"]')).toContainText('Writes a change file suggesting frames, scenes or notes to move to the Trash.');
  await expect(panel.getByRole('region', { name: 'Suggests (writes a change file)' }).locator('[data-assistant-tool]')).toHaveCount(6);
  await expect(panel.locator('[data-assistant-privacy]')).toContainText('Stored contact details are never read');
  await expect(panel).toContainText('“Harbor Lights Suggestions” folder beside the project');
  const scope = panel.locator('[data-assistant-scope]');
  await expect(scope.getByRole('heading', { name: 'What the assistant can suggest' })).toBeVisible();
  await expect(scope).toContainText('Frames: move to the Trash, change, add and reorder.');
});

test('in Spanish: Asistente de IA, its tools and what it can suggest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(page);
  const app = await openSettings(page, 'App');
  await app.getByLabel('Language').selectOption('es');
  await applySettings(page);
  const window = page.getByRole('dialog', { name: 'Configuración' });
  await window.getByRole('tab', { name: 'Asistente de IA', exact: true }).click();
  const panel = window.getByRole('tabpanel', { name: 'Asistente de IA', exact: true });
  await expect(panel.locator('[data-assistant-tool]')).toHaveCount(ASSISTANT_TOOLS.length);
  await expect(panel.getByRole('heading', { name: 'Las herramientas del asistente' })).toBeVisible();
  await expect(panel.locator('[data-assistant-tool="suggest_trash"]')).toContainText('Escribe un archivo de cambios que sugiere cuadros, escenas o notas para enviar a la Papelera.');
  await expect(panel.locator('[data-assistant-privacy]')).toContainText('Los datos de contacto guardados nunca se leen');
  await expect(panel.locator('[data-assistant-scope]').getByRole('heading', { name: 'Lo que el asistente puede sugerir' })).toBeVisible();
  await closeSettings(page);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`Settings → AI assistant passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await fresh(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await openSettings(page, 'AI assistant');
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(tags).include('[data-assistant-tab]').analyze()).violations).toEqual([]);
  });
}
