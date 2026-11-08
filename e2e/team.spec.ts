import { expect, test } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// Characters cast and the Team section (3.5b) in the memory build: a script brings in its speaking characters; one is
// cast from a person's editor in Cast and crew, one edit; the Team section lists the people by department, the cast
// member with the character they play.

test('a character from the script is cast, and the Team section lists people by department', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  // A script with two speaking characters.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Import script…' }).click();
  await (await chooser).setFiles({
    name: 'Bey County.fountain',
    mimeType: 'text/plain',
    buffer: Buffer.from('INT. DINER - NIGHT\n\nMary wipes the counter.\n\nMARY\nWe’re closed.\n\nJOE\nNot to me.\n'),
  });
  await page.getByRole('dialog', { name: /^Import / }).getByRole('button', { name: 'Import 1 scene' }).click();

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  const editor = people.locator('[data-person-editor]');
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Ana Ruiz');
  await page.keyboard.press('Enter');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Cast' });
  await editor.getByRole('button', { name: 'Cast', exact: true }).click();
  const plays = editor.getByRole('group', { name: 'Plays' });
  await plays.getByRole('button', { name: 'MARY', exact: true }).click();
  await expect(plays.getByRole('button', { name: 'MARY', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(plays.getByRole('button', { name: 'JOE', exact: true })).toHaveAttribute('aria-pressed', 'false');
  // A second person, in camera; MARY reads as Ana's from here.
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Kevin Matos');
  await page.keyboard.press('Enter');
  await editor.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(editor.getByRole('group', { name: 'Plays' }).getByRole('button', { name: /^MARY · played by Ana Ruiz/ })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Team/ }).click();
  const team = page.getByRole('region', { name: 'Team', exact: true });
  await expect(team.getByRole('heading', { level: 3 })).toHaveText(['Camera', 'Cast']);
  await expect(team.getByRole('region', { name: 'Cast' }).getByRole('listitem')).toHaveText([/Ana Ruiz.*Cast.*as MARY/]);
  await expect(team.getByRole('region', { name: 'Camera' }).getByRole('listitem')).toHaveText([/Kevin Matos/]);
});
