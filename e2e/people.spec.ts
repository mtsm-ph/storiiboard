import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The Cast & crew tile (3.5) in the memory build: a person added and named, given a role, departments, a title and a
// phone, each one edit; one ⌘Z takes back the last; Delete sends them to the Trash and Restore brings them back.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Production/ }).click();
});

const tile = (page: Page) => page.getByRole('region', { name: 'Cast and crew', exact: true });
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

test('a person is added, named, given a role, departments and contacts; Delete and Restore', async ({ page }) => {
  const people = tile(page);
  const editor = people.locator('[data-person-editor]');
  await expect(people.getByText('No one yet.', { exact: false })).toBeVisible();
  await people.getByRole('button', { name: '+ New person' }).click();
  await expect(editor.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await page.keyboard.type('Kevin Matos');
  await page.keyboard.press('Enter');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Director of photography' });
  await editor.getByRole('button', { name: 'Camera', exact: true }).click();
  await editor.getByRole('button', { name: 'Grip & electric', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const list = people.getByRole('list', { name: 'Cast and crew' });
  await expect(list.getByRole('button')).toHaveText([/Kevin Matos.*Director of photography · Camera, Grip & electric/]);
  await editor.getByRole('textbox', { name: 'Phone' }).fill('+1 212 555 0100');
  // Left for a button, where ⌘Z is the project's (in a text field it's the field's own). One ⌘Z: the phone back to
  // empty, the departments as they are.
  await editor.getByRole('button', { name: 'Camera', exact: true }).focus();
  await page.keyboard.press(await undoKey(page));
  await expect(editor.getByRole('textbox', { name: 'Phone' })).toHaveValue('');
  await expect(editor.getByRole('button', { name: 'Grip & electric', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // WCAG 2.2 AA, as the app's other checks run it, light and dark.
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[aria-label="Cast and crew"]').withTags(tags).analyze()).violations).toEqual([]);
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect((await new AxeBuilder({ page }).include('[aria-label="Cast and crew"]').withTags(tags).analyze()).violations).toEqual([]);
  // Delete, then Restore from the Trash.
  await editor.getByRole('button', { name: 'Delete person' }).click();
  await expect(people.getByText('No one yet.', { exact: false })).toBeVisible();
  // The last one gone: the focus goes to New person.
  await expect(people.getByRole('button', { name: '+ New person' })).toBeFocused();
  await expect(page.getByText('Moved Kevin Matos to the Trash.')).toBeVisible();
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('region', { name: 'Trash', exact: true }).getByRole('button', { name: 'Restore person Kevin Matos' }).click();
  await expect(list.getByRole('button')).toHaveText([/Kevin Matos/]);
});

// "+ New person" gives the name field focus as its click is handled, before the save (Kevin, Nov 20: a WebKit run typed
// "Sam Ortiz" straight after the click, as a person does, and saved "am Ortiz" while focus waited on the save).

/** Clicks "+ New person" from the page and says, in the same turn, what has focus then. */
const clickNewPerson = (page: Page) =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ New person');
    button?.click();
    const active = document.activeElement;
    return { field: active?.getAttribute('data-field') ?? null, inEditor: active?.closest('[data-person-editor]') !== null };
  });

/**
 * Slows every edit's turn in the store by `ms` (and makes the first one fail, with `failFirst`), from the page: the
 * build waits in the queue, as a slow disk's write would, so later edits still land after it.
 */
const slowEdits = (page: Page, ms: number, failFirst = false) =>
  page.evaluate(
    async ({ ms, failFirst }) => {
      const url = '/src/app/projectStore.ts';
      const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
      const original = projectStore.getState().applyWith;
      const w = window as unknown as { __editsLanded: number };
      w.__editsLanded = 0;
      let first = failFirst;
      projectStore.setState({
        applyWith: (build) => {
          const fail = first;
          first = false;
          return original(async (records, slate) => {
            await new Promise((resolve) => setTimeout(resolve, ms));
            // An update of a record that isn't there: the store refuses it and says so, as a failed write does.
            return fail ? { changes: [{ kind: 'update' as const, id: 'no-such-record', set: { name: 'x' } }] } : build(records, slate);
          }).finally(() => {
            w.__editsLanded += 1;
          });
        },
      });
    },
    { ms, failFirst },
  );

const editsLanded = (page: Page) => page.evaluate(() => (window as unknown as { __editsLanded: number }).__editsLanded);

const storedPeople = (page: Page) =>
  page.evaluate(async () => {
    const url = '/src/app/projectStore.ts';
    const { projectStore } = (await import(/* @vite-ignore */ url)) as typeof import('../src/app/projectStore');
    return Object.values(projectStore.getState().records)
      .filter((r) => r.type === 'person' && r.trashedAt === null)
      .map((r) => r.props.name)
      .sort();
  });

test('the name field has focus as the + New person click is handled; a name typed at once keeps its first letter', async ({ page }) => {
  const people = tile(page);
  const editor = people.locator('[data-person-editor]');
  await people.getByRole('button', { name: '+ New person' }).waitFor();
  expect(await clickNewPerson(page)).toEqual({ field: 'name', inEditor: true });
  await page.keyboard.type('Sam Ortiz');
  await page.keyboard.press('Enter');
  await expect(people.getByRole('list', { name: 'Cast and crew' }).getByRole('button')).toHaveText([/^Sam Ortiz/]);
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Sam Ortiz');
  await expect.poll(() => storedPeople(page)).toEqual(['Sam Ortiz']);
});

test('with a slow save, the name field still has focus at once, keeps what was typed, and making the person is one step', async ({ page }) => {
  const people = tile(page);
  const editor = people.locator('[data-person-editor]');
  await people.getByRole('button', { name: '+ New person' }).waitFor();
  await slowEdits(page, 800);
  expect(await clickNewPerson(page)).toEqual({ field: 'name', inEditor: true });
  await page.keyboard.type('Sam');
  // Typed before the save landed: nothing is written yet.
  expect(await editsLanded(page)).toBe(0);
  expect(await storedPeople(page)).toEqual([]);
  // The record arriving leaves the field, its focus and its text as they are.
  await expect.poll(() => editsLanded(page)).toBe(1);
  await expect(editor.getByRole('textbox', { name: 'Name' })).toBeFocused();
  await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue('Sam');
  await page.keyboard.type(' Ortiz');
  await page.keyboard.press('Enter');
  await expect.poll(() => storedPeople(page)).toEqual(['Sam Ortiz']);
  await expect(people.getByRole('list', { name: 'Cast and crew' }).getByRole('button')).toHaveText([/^Sam Ortiz/]);
  // A double click on + New person still makes one person.
  await people.getByRole('button', { name: '+ New person' }).dblclick();
  await expect.poll(() => editsLanded(page)).toBe(3);
  await expect.poll(() => storedPeople(page)).toEqual(['', 'Sam Ortiz']);
  // One ⌘Z takes the new person back, the next the name: making a person is one step, naming them another.
  await people.getByRole('button', { name: '+ New person' }).focus();
  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => storedPeople(page)).toEqual(['Sam Ortiz']);
  await page.keyboard.press(await undoKey(page));
  await expect.poll(() => storedPeople(page)).toEqual(['']);
});

test('when making the person fails, no one appears, nothing typed is saved and focus goes back to + New person', async ({ page }) => {
  const people = tile(page);
  await people.getByRole('button', { name: '+ New person' }).waitFor();
  await slowEdits(page, 500, true);
  expect(await clickNewPerson(page)).toEqual({ field: 'name', inEditor: true });
  await page.keyboard.type('Sam Ortiz');
  await expect.poll(() => editsLanded(page)).toBeGreaterThanOrEqual(1);
  await expect(people.getByRole('button', { name: '+ New person' })).toBeFocused();
  await expect(people.getByText('No one yet.', { exact: false })).toBeVisible();
  await expect(people.locator('[data-person-editor]')).toHaveCount(0);
  // The name left with the field is an edit of no one: once it has had its turn, nothing was written.
  await expect.poll(() => editsLanded(page)).toBe(2);
  expect(await storedPeople(page)).toEqual([]);
});
