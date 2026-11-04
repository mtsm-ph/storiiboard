import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaFields, readOriginal, type PreparedImage } from '../../core/media/store';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { themeFor } from '../../ui/theme/generator/generate';
import { readProjectTheme, themeProp } from '../../ui/theme/projectTheme';
import { createProjectStore } from '../projectStore';
import { currentTheme, resetTheme, setTheme, type ThemeImage, type ThemePatch } from './themeEdits';

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
const set = (patch: ThemePatch) =>
  store.getState().applyWith((now) => setTheme(now, project.projectId, patch, { projectPath: project.file.path, osDark: false }));
const liveMedia = () => Object.values(records()).filter((r) => r.type === 'media' && r.trashedAt === null);
const shown = () => currentTheme(records(), project.projectId, false);

describe('a project’s theme', () => {
  it('stores the image under the project and the theme with its tokens in one edit, which one undo takes back', async () => {
    const image = logo(3);
    await set({ image, mode: 'dark' });
    const [media] = liveMedia();
    expect(media?.parentId).toBe(project.projectId);
    expect(mediaFields(media?.props ?? {})?.sha256).toBe(image.image.original.sha256);
    expect((await readOriginal(project.file, image.image.original.sha256))?.bytes).toEqual(image.image.original.bytes);
    // The image's most saturated accent is the default.
    expect(readProjectTheme(theme())).toEqual({ mode: 'dark', tokens: { light: themeFor('#1E6BD6').light, dark: themeFor('#1E6BD6').dark } });
    expect(theme()).toMatchObject({ source: 'image', image_id: media?.id, accent_picked: '#1E6BD6', candidates: image.candidates });
    expect(shown()).toMatchObject({ choice: { accent: '#1E6BD6', mode: 'dark' }, imageId: media?.id, candidates: image.candidates, stored: true });

    await store.getState().undo();
    expect(theme()).toBeUndefined();
    expect(liveMedia()).toEqual([]);
    await store.getState().redo();
    expect(shown()).toMatchObject({ choice: { accent: '#1E6BD6', mode: 'dark' }, imageId: media?.id });
  });

  it('calls an accent typed in by hand manual, and keeps the image and mode it had', async () => {
    await set({ image: logo(4), mode: 'dark' });
    const imageId = shown().imageId;
    await set({ accent: '#2e8b57' });
    expect(theme()).toMatchObject({ source: 'manual', image_id: imageId, accent_picked: '#2E8B57', mode: 'dark' });
    expect(liveMedia()).toHaveLength(1);
  });

  it('works each change out from the project when it lands, so quick ones never undo each other', async () => {
    await set({ image: logo(5) });
    // Replace twice before either lands, then Dark: each sees what the last one left.
    await Promise.all([set({ image: logo(6, ['#C2185B']) }), set({ image: logo(9, ['#7A3FB5']) }), set({ mode: 'dark' })]);
    expect(liveMedia()).toHaveLength(1);
    expect(shown()).toMatchObject({ choice: { accent: '#7A3FB5', mode: 'dark' }, candidates: ['#7A3FB5'] });
    // The two replaced images are in the Trash, none left over named by nothing.
    expect(Object.values(records()).filter((r) => r.type === 'media' && r.trashedAt !== null)).toHaveLength(2);
  });

  it('sends a replaced image to the Trash in the same edit, and undo brings it back as the image', async () => {
    await set({ image: logo(5) });
    const firstId = shown().imageId;
    await set({ image: logo(6, ['#C2185B']) });
    expect(firstId && records()[firstId]?.trashedAt).not.toBeNull();
    await store.getState().undo();
    expect(shown().imageId).toBe(firstId);
    expect(liveMedia()).toHaveLength(1);
  });

  it('stores the kit’s look in the mode picked when there’s no image and no accent; its orange counts as none', async () => {
    await set({ accent: null, mode: 'dark' });
    expect(theme()).toMatchObject({ source: 'default', mode: 'dark', image_id: null });
    expect(readProjectTheme(theme())).toEqual({ mode: 'dark', tokens: null });
    expect(shown().choice).toEqual({ accent: null, mode: 'dark' });
    await set({ image: logo(10) });
    await set({ accent: '#DF5E27' });
    // The kit's swatch picked with an image: the kit's exact look, still from that image.
    expect(theme()).toMatchObject({ source: 'image', tokens: readTokensOf(themeFor(null)) });
    expect(shown().choice.accent).toBeNull();
  });

  it('regenerates from the accent picked even when the stored tokens can’t be read', async () => {
    await set({ image: logo(11), mode: 'dark' });
    const broken = structuredClone(theme()) as { tokens: { light: Record<string, string> } };
    broken.tokens.light.bg = 'paper';
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { theme: broken } }]);
    expect(shown().choice.accent).toBe('#1E6BD6');
    await set({});
    expect(readProjectTheme(theme())?.tokens?.light).toEqual(themeFor('#1E6BD6').light);
  });

  it('never shows or trashes a record that isn’t the project’s own image', async () => {
    await set({ image: logo(12) });
    // A hand-edited file naming the project itself as the image.
    const tampered = { ...(theme() as Record<string, unknown>), image_id: project.projectId };
    await store.getState().apply([{ kind: 'update', id: project.projectId, set: { theme: tampered } }]);
    expect(shown().imageId).toBeNull();
    await store.getState().applyWith((now) => ({ changes: resetTheme(now, project.projectId) }));
    expect(records()[project.projectId]?.trashedAt).toBeNull();
    expect(theme()).toBeUndefined();
  });

  it('resets to the kit, the image to the Trash, and one undo brings both back', async () => {
    await set({ image: logo(7), mode: 'dark' });
    const imageId = shown().imageId;
    await store.getState().applyWith((now) => ({ changes: resetTheme(now, project.projectId) }));
    expect(theme()).toBeUndefined();
    expect(liveMedia()).toEqual([]);
    // With no theme, the person's own system mode shows, and there's nothing to regenerate or reset.
    expect(currentTheme(records(), project.projectId, true)).toMatchObject({ choice: { accent: null, mode: 'dark' }, stored: false });
    expect(resetTheme(records(), project.projectId)).toEqual([]);
    await store.getState().undo();
    expect(shown()).toMatchObject({ imageId, choice: { accent: '#1E6BD6' } });
  });

  it('is still there after the project is closed and opened again', async () => {
    await set({ image: logo(8), mode: 'dark' });
    await store.getState().close();
    project = await openProject(project.file.path, { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(readProjectTheme(records()[project.projectId]?.props.theme)?.mode).toBe('dark');
    expect(liveMedia()).toHaveLength(1);
  });
});

/** A theme's tokens as the file stores them, for comparing with what was written. */
function readTokensOf(t: ReturnType<typeof themeFor>) {
  return (themeProp(t, { source: 'image', mode: 'light', imageId: null, candidates: [] }) as { tokens: unknown }).tokens;
}
