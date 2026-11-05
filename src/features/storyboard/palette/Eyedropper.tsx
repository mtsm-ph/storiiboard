import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import { sceneFields, sceneLabel } from '../../../core/model/storyboard';
import { MAX_PALETTE, normalHex, withColor } from '../../../core/model/palette';
import { hex as toHex } from '../../../ui/theme/generator/color';
import { editPalette } from './actions';

// The eyedropper (polish PP): "Pick from a frame" in a scene's palette, then a click on any frame's picture (on the
// board, the strip or the inspector) adds the colour under the pointer to that scene's palette. Escape, or the button
// again, stops it. The engine's EyeDropper API isn't in WebKit, so the app reads the picture itself: the few pixels
// around the point, drawn colour-managed onto sRGB like a palette's (read.ts), averaged.

interface EyedropperState {
  /** The scene whose palette a pick goes to; null when the eyedropper is off. */
  sceneId: string | null;
}

export const eyedropperStore = createStore<EyedropperState>()(() => ({ sceneId: null }));

export function startEyedropper(sceneId: string): void {
  eyedropperStore.setState({ sceneId });
}

export function stopEyedropper(): void {
  eyedropperStore.setState({ sceneId: null });
}

export const useEyedropperScene = (): string | null => useStore(eyedropperStore, (s) => s.sceneId);

/** The colour at a point of a picture: the 5 by 5 pixels around it, averaged, in sRGB. Null when it can't be read. */
export function colourAt(img: HTMLImageElement, clientX: number, clientY: number): string | null {
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || img.naturalWidth === 0) return null;
  const x = ((clientX - rect.left) / rect.width) * img.naturalWidth;
  const y = ((clientY - rect.top) / rect.height) * img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = 5;
  canvas.height = 5;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, x - 2.5, y - 2.5, 5, 5, 0, 0, 5, 5);
  const data = ctx.getImageData(0, 0, 5, 5).data;
  const sum = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue;
    sum[0] = (sum[0] ?? 0) + (data[i] ?? 0);
    sum[1] = (sum[1] ?? 0) + (data[i + 1] ?? 0);
    sum[2] = (sum[2] ?? 0) + (data[i + 2] ?? 0);
    count += 1;
  }
  if (count === 0) return null;
  return normalHex(toHex([Math.round((sum[0] ?? 0) / count), Math.round((sum[1] ?? 0) / count), Math.round((sum[2] ?? 0) / count)]));
}

export type AddOutcome = 'added' | 'there' | 'full' | 'none';

/**
 * Adds a colour to a scene's palette as one edit, and says so (or that it was there already, or the palette is full).
 * Says nothing when nothing was written: the scene went meanwhile, or the write was refused (which says why itself).
 */
export async function addColour(sceneId: string, hex: string): Promise<AddOutcome> {
  const scene = projectStore.getState().records[sceneId];
  const name = sceneLabel(sceneFields(scene?.props ?? {}).number);
  // Set only inside the edit, which runs only for a live scene at its turn.
  const result: { outcome: AddOutcome } = { outcome: 'none' };
  const written = await editPalette(sceneId, (palette) => {
    const next = withColor(palette, hex);
    result.outcome = next !== palette ? 'added' : palette.colors.some((c) => c.hex === hex) ? 'there' : 'full';
    return next;
  });
  const outcome = written ? result.outcome : 'none';
  if (outcome === 'added') showInfo(t('palette.added', { hex, scene: name }), { step: true });
  else if (outcome === 'there') showInfo(t('palette.alreadyThere', { hex, scene: name }));
  else if (outcome === 'full') showInfo(t('palette.full', { hex, scene: name, max: MAX_PALETTE }));
  return outcome;
}

/**
 * The click that follows a pick's press, however long the button is held: swallowed, so it never selects the frame
 * under it. Dropped at the next press or key, if the press ended away from the picture and no click came.
 */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    drop();
  };
  const drop = () => {
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('pointerdown', drop, true);
    window.removeEventListener('pointercancel', drop, true);
    window.removeEventListener('keydown', drop, true);
  };
  window.addEventListener('click', swallow, true);
  // After this press's own listeners: the next press, a cancelled one, or a key (whose Enter clicks with no press)
  // drops it, so it never eats a click it wasn't for.
  setTimeout(() => {
    window.addEventListener('pointerdown', drop, true);
    window.addEventListener('pointercancel', drop, true);
    window.addEventListener('keydown', drop, true);
  });
}

/**
 * While the eyedropper is on: the pointer is a crosshair over pictures, and a press on one picks its colour instead of
 * selecting or dragging the frame. Renders nothing.
 */
export function EyedropperHost(): null {
  const sceneId = useEyedropperScene();
  // Another project opened: a pick for this one's scene goes nowhere, so the eyedropper stops.
  const path = useStore(projectStore, (s) => s.project?.file.path);
  useEffect(() => stopEyedropper, [path]);
  useEffect(() => {
    if (!sceneId) return;
    const root = document.documentElement;
    root.dataset.eyedropper = '';
    /**
     * The frame picture under the pointer, when nothing else is over it: everything above it at that point must be the
     * picture's own frame (a sketch, the crop editor's handles), never a menu or another window drawn over it.
     */
    const pictureAt = (event: PointerEvent): HTMLImageElement | null => {
      const stack = document.elementsFromPoint(event.clientX, event.clientY);
      const at = stack.findIndex((el) => el instanceof HTMLImageElement && el.dataset.frameImage !== undefined);
      const img = stack[at];
      if (!(img instanceof HTMLImageElement)) return null;
      // The picture's holder and what's drawn with it: the frame's picture area.
      const area = img.parentElement?.parentElement;
      return area && stack.slice(0, at).every((el) => area.contains(el)) ? img : null;
    };
    const onPointerDown = (event: PointerEvent) => {
      const img = pictureAt(event);
      if (!img || event.button !== 0) return;
      // Picking, not selecting or dragging the frame under it.
      event.preventDefault();
      event.stopPropagation();
      swallowNextClick();
      let hex: string | null = null;
      try {
        hex = colourAt(img, event.clientX, event.clientY);
      } catch {
        hex = null;
      }
      // A point it can't read (see-through, still loading) leaves the eyedropper on, to try another.
      if (!hex) {
        showInfo(t('palette.pickFailed'));
        return;
      }
      stopEyedropper();
      void addColour(sceneId, hex);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // An input method's Escape is its own.
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      stopEyedropper();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      delete root.dataset.eyedropper;
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [sceneId]);
  return null;
}
