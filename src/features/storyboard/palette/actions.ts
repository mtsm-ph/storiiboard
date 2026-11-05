import { showInfo, showNotice } from '../../../app/notice';
import { projectStore } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import { emptyPalette, paletteChange, paletteOf, regenerated, type Palette } from '../../../core/model/palette';
import { aspectRatioValue, projectStoryboard } from '../../../core/model/storyboard';
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
export async function generatePalette(sceneId: string): Promise<boolean> {
  const { project, records } = projectStore.getState();
  const scene = records[sceneId];
  if (!project || scene?.type !== 'scene') return false;
  const current = paletteOf(scene.props) ?? emptyPalette();
  const aspect = aspectRatioValue(projectStoryboard(records[project.projectId]?.props).aspectRatio);
  const pixels = await scenePixels(project.file, records, sceneId, aspect);
  // Another project opened meanwhile (a version copy has the same ids): this one's colours go nowhere.
  if (projectStore.getState().project !== project) return false;
  // More than the places to fill, so a candidate too close to a colour already there can give way to the next.
  const found = paletteFromFrames(pixels, Math.min(16, current.size * 2 + 4), (generations += 1));
  if (found.length === 0) {
    showInfo(t('palette.noPictures'));
    return false;
  }
  // Regenerate offers other colours: ones unlike the unlocked colours there now come first, those after them, so
  // what was there comes back only when the frames have nothing else.
  const replaced = current.colors.filter((c) => !c.locked).map((c) => c.hex);
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
  if (outcome.unchanged) showInfo(outcome.allLocked ? t('palette.allLocked') : t('palette.nothingNew'));
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
