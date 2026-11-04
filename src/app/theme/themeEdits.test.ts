import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaFields, readOriginal, type PreparedImage } from '../../core/media/store';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { themeFor } from '../../ui/theme/generator/generate';
import { readProjectTheme } from '../../ui/theme/projectTheme';
import { createProjectStore } from '../projectStore';
import { currentTheme, resetTheme, setTheme, type ThemeImage } from './themeEdits';

function logo(seed: number, candidates = ['#1E6BD6', '#C2185B']): ThemeImage {
  const bytes = new Uint8Array(4000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
      mime: 'image/png',
      width: 512,
      height: 512,
      colorSpace: 'srgb',
    },
    thumbnail: { bytes: bytes.slice(0, 500), mime: 'image/png', width: 512, height: 512, longEdge: 512 },
  };
  return { image, source: { name: `logo-${String(seed)}.png` }, candidates, previewUrl: '' };
}

let folder: TestFolder;
let project: Project;
const store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const theme = () => records()[project.projectId]?.props.theme;
const set = (choice: Parameters<typeof setTheme>[2], options: Omit<Parameters<typeof setTheme>[3], 'projectPath'>) =>
  store.getState().applyWith((now) => setTheme(now, project.projectId, choice, { ...options, projectPath: project.file.path }));
const liveMedia = () => Object.values(records()).filter((r) => r.type === 'media' && r.trashedAt === null);

describe('a project’s theme', () => {
  it('stores the image under the project and the theme with its tokens in one edit, which one undo takes back', async () => {
    const image = logo(3);
    await set({ accent: '#1E6BD6', mode: 'dark' }, { image, candidates: image.candidates });
    const [media] = liveMedia();
    expect(media?.parentId).toBe(project.projectId);
    expect(mediaFields(media?.props ?? {})?.sha256).toBe(image.image.original.sha256);
    expect((await readOriginal(project.file, image.image.original.sha256))?.bytes).toEqual(image.image.original.bytes);
    const stored = readProjectTheme(theme());
    expect(stored).toEqual({ mode: 'dark', tokens: { light: themeFor('#1E6BD6').light, dark: themeFor('#1E6BD6').dark } });
    expect(theme()).toMatchObject({ source: 'image', image_id: media?.id, accent_picked: '#1E6BD6', candidates: image.candidates });

    const shown = currentTheme(records(), project.projectId, false);
    expect(shown).toMatchObject({ choice: { accent: '#1E6BD6', mode: 'dark' }, imageId: media?.id, candidates: image.candidates });

    await store.getState().undo();
    expect(theme()).toBeUndefined();
    expect(liveMedia()).toEqual([]);
  });

  it('calls an accent typed in by hand manual, and keeps the image it had', async () => {
    const image = logo(4);
    await set({ accent: '#1E6BD6', mode: 'light' }, { image, candidates: image.candidates });
    const imageId = currentTheme(records(), project.projectId, false).imageId;
    await set({ accent: '#2E8B57', mode: 'light' }, { keepImageId: imageId, candidates: image.candidates });
    expect(theme()).toMatchObject({ source: 'manual', image_id: imageId, accent_picked: '#2E8B57' });
    expect(liveMedia()).toHaveLength(1);
  });

  it('sends a replaced image to the Trash in the same edit', async () => {
    const first = logo(5);
    await set({ accent: '#1E6BD6', mode: 'light' }, { image: first, candidates: first.candidates });
    const firstId = currentTheme(records(), project.projectId, false).imageId;
    const second = logo(6, ['#C2185B']);
    await set({ accent: '#C2185B', mode: 'light' }, { image: second, keepImageId: firstId, candidates: second.candidates });
    expect(firstId && records()[firstId]?.trashedAt).not.toBeNull();
    expect(liveMedia()).toHaveLength(1);
    await store.getState().undo();
    expect(currentTheme(records(), project.projectId, false).imageId).toBe(firstId);
    expect(liveMedia()).toHaveLength(1);
  });

  it('stores the kit’s look in the mode picked when there’s no image and no accent', async () => {
    await set({ accent: null, mode: 'dark' }, { candidates: [] });
    expect(theme()).toMatchObject({ source: 'default', mode: 'dark', image_id: null });
    // The kit's colours, in the mode chosen.
    expect(readProjectTheme(theme())).toEqual({ mode: 'dark', tokens: null });
    expect(currentTheme(records(), project.projectId, false).choice).toEqual({ accent: null, mode: 'dark' });
  });

  it('resets to the kit, the image to the Trash, and one undo brings both back', async () => {
    const image = logo(7);
    await set({ accent: '#1E6BD6', mode: 'dark' }, { image, candidates: image.candidates });
    const imageId = currentTheme(records(), project.projectId, false).imageId;
    await store.getState().applyWith((now) => ({ changes: resetTheme(now, project.projectId) }));
    expect(theme()).toBeUndefined();
    expect(liveMedia()).toEqual([]);
    // With no theme, the person's own system mode shows.
    expect(currentTheme(records(), project.projectId, true).choice).toEqual({ accent: null, mode: 'dark' });
    await store.getState().undo();
    expect(currentTheme(records(), project.projectId, false)).toMatchObject({ imageId, choice: { accent: '#1E6BD6' } });
  });

  it('is still there after the project is closed and opened again', async () => {
    const image = logo(8);
    await set({ accent: '#1E6BD6', mode: 'dark' }, { image, candidates: image.candidates });
    await store.getState().close();
    project = await openProject(project.file.path, { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(readProjectTheme(records()[project.projectId]?.props.theme)?.mode).toBe('dark');
    expect(liveMedia()).toHaveLength(1);
  });
});
