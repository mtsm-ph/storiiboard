import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showInfo, showNotice } from '../../../app/notice';
import { projectStore } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import type { SbdRecord } from '../../../core/model/record';
import { emptyPalette, paletteChange, paletteOf, regenerated, type Palette } from '../../../core/model/palette';
import { aspectRatioValue, projectStoryboard } from '../../../core/model/storyboard';
import type { Lab } from '../../../ui/theme/generator/color';
import { distinctHex, paletteFromFrames } from './extract';
import { scenePixels } from './read';

// What the palette editor does (polish PP). Each is one edit, worked out from the scene as it is when it lands, so
// quick changes all stay and ⌘Z takes each back.

/** One edit to a scene's palette; `edit` gets the palette as it is then (a new one if the scene has none). */
export function editPalette(sceneId: string, edit: (palette: Palette) => Palette | null): Promise<boolean> {
  return projectStore.getState().applyWith((now) => {
    const scene = now[sceneId];
    if (scene?.type !== 'scene' || scene.trashedAt !== null) return { changes: [] };
    const before = paletteOf(scene.props);
    const next = edit(before ?? emptyPalette());
    // An edit that changes nothing (the count already picked, say) isn't a step in History.
    const change = next ? paletteChange(next) : null;
    const same = JSON.stringify(change?.set?.palette) === JSON.stringify(before ? paletteChange(before).set?.palette : undefined);
    return { changes: change && !same ? [{ kind: 'update', id: sceneId, ...change }] : [] };
  });
}

/**
 * Generates the scene's palette from its frames' pictures: a first one, or again around its locked colours. Resolves
 * to false when nothing was written (no picture could be read, or the scene went meanwhile).
 */
export function generatePalette(sceneId: string): Promise<boolean> {
  return generateFrom(sceneId, (project, records, aspect) => scenePixels(project.file, records, sceneId, aspect), { none: t('palette.noPictures'), nothingNew: t('palette.nothingNew') });
}

/** What reads the pictures a palette is made from: the project's file, its records and the frames' aspect ratio. */
export type ReadPictures = (project: NonNullable<ReturnType<typeof projectStore.getState>['project']>, records: Readonly<Record<string, SbdRecord>>, aspect: number) => Promise<Lab[][]>;

/**
 * Sets the scene's palette from pictures `read` finds: the frames' (Generate) or a board's (5.6b). Either way the palette's
 * size and locked colours are kept, in one op group. `words` say it when nothing could be read or the pictures offer nothing new.
 */
export async function generateFrom(
  sceneId: string,
  read: ReadPictures,
  words: { none: string; nothingNew: string },
  { preferNew = true }: { preferNew?: boolean } = {},
): Promise<boolean> {
  // One run at a time for a scene: a second press (or a board's while Generate reads) writes nothing.
  if (generating.getState().scenes.has(sceneId)) return false;
  generating.setState({ scenes: new Set([...generating.getState().scenes, sceneId]) });
  try {
    return await generateRun(sceneId, read, words, preferNew);
  } finally {
    const rest = new Set(generating.getState().scenes);
    rest.delete(sceneId);
    generating.setState({ scenes: rest });
  }
}

/** The scenes whose palette is being made now (Generate, or from a board): their buttons say so and wait. */
const generating = createStore<{ scenes: ReadonlySet<string> }>()(() => ({ scenes: new Set() }));
export const useGenerating = (sceneId: string): boolean => useStore(generating, (s) => s.scenes.has(sceneId));
export const isGenerating = (sceneId: string): boolean => generating.getState().scenes.has(sceneId);

async function generateRun(sceneId: string, read: ReadPictures, words: { none: string; nothingNew: string }, preferNew: boolean): Promise<boolean> {
  const { project, records } = projectStore.getState();
  const scene = records[sceneId];
  if (!project || scene?.type !== 'scene') return false;
  const current = paletteOf(scene.props) ?? emptyPalette();
  const aspect = aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio);
  const pixels = await read(project, records, aspect);
  // Another project opened meanwhile (a version copy has the same ids): this one's colours go nowhere.
  if (projectStore.getState().project !== project) return false;
  // More than the places to fill, so a candidate too close to a colour already there can give way to the next.
  const found = paletteFromFrames(pixels, Math.min(16, current.size * 2 + 4), preferNew ? (generations += 1) : 1);
  if (found.length === 0) {
    showInfo(words.none);
    return false;
  }
  // Regenerate offers other colours: ones unlike the unlocked colours there now come first, those after them, so
  // what was there comes back only when the frames have nothing else.
  // A board's palette is its main colours, near the old ones or not, and the same each time (preferNew off).
  const replaced = preferNew ? current.colors.filter((c) => !c.locked).map((c) => c.hex) : [];
  const fresh = found.filter((hex) => replaced.every((old) => distinctHex(hex, old)));
  const candidates = [...fresh, ...found.filter((hex) => !fresh.includes(hex))];
  // Said only when the frames really offered nothing new, not when the write was dropped or refused (which says why).
  const outcome = { unchanged: false, allLocked: false };
  const written = await editPalette(sceneId, (palette) => {
    const next = regenerated(palette, candidates, distinctHex);
    outcome.allLocked = palette.colors.length >= palette.size && palette.colors.every((c) => c.locked);
    outcome.unchanged = palette.colors.length > 0 && JSON.stringify(paletteChange(next)) === JSON.stringify(paletteChange(palette));
    return next;
  });
  // Every place taken by a locked colour: raising the count is what helps.
  if (outcome.unchanged) showInfo(outcome.allLocked ? t('palette.allLocked') : words.nothingNew);
  return written;
}

/** Each Generate clusters from its own start, so pressing it again can find other colours. */
let generations = 0;

/** Copies a colour's hex for another app, and says so. */
export function copyHex(hex: string): void {
  navigator.clipboard.writeText(hex).then(
    () => {
      showInfo(t('palette.copied', { hex }));
    },
    () => {
      showNotice(new Error(t('palette.copyFailed', { hex })));
    },
  );
}
