import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../app/projectStore';
import { t } from '../../core/i18n';
import type { CanvasColours } from '../../ui/canvas/types';
import { cropBox, DEFAULT_CROP, type Crop } from '../../core/media/crop';
import { wholePicture, type CropRect } from '../../ui/canvas/cropping';
import { decodedPicture, levelFor, loadPicture, onFullDropped, useDecodedGeneration, type PictureLevel } from '../../core/media/decoded';

// A stored picture on the canvas (5.1b): the thumbnail until the item is drawn larger than 640 device pixels on its
// long edge (and always for one out of view), then the stored picture. The thumbnail stays up while the large one loads, so zooming never flashes empty.

/** Which size each picture item is drawn at now, so the end-to-end tests (and the board's data) can say. */
export const drawnLevels = createStore<{ levels: Readonly<Record<string, PictureLevel>> }>()(() => ({ levels: {} }));

export const useDrawnLevels = () => useStore(drawnLevels, (s) => s.levels);

/**
 * The items whose picture is gone from the file (round 5, 6.27b): drawn as an empty box with the words a gone picture
 * shows, the same condition. The board's data says it per picture item (`missing`), as the canvas is pixels.
 */
export const gonePictures = createStore<{ ids: ReadonlySet<string> }>()(() => ({ ids: new Set<string>() }));

export const useGonePictures = () => useStore(gonePictures, (s) => s.ids);

function reportGone(id: string, gone: boolean) {
  const { ids } = gonePictures.getState();
  if (ids.has(id) === gone) return;
  const next = new Set(ids);
  if (gone) next.add(id);
  else next.delete(id);
  gonePictures.setState({ ids: next });
}

function report(id: string, level: PictureLevel | null) {
  const { levels } = drawnLevels.getState();
  if (level === null ? !(id in levels) : levels[id] === level) return;
  const next = Object.fromEntries(Object.entries(levels).filter(([key]) => key !== id));
  drawnLevels.setState({ levels: level === null ? next : { ...next, [id]: level } });
}

/** How strongly the part being cut is drawn during a crop drag (6.5.7b). */
const CUT_OPACITY = 0.3;

/** Tried again this long after a read or decode went wrong (a busy disk, a file mid-write). */
const RETRY_MS = 3000;

/**
 * What the picture shows now: undefined while the first read is on its way, null when the file doesn't hold it. A read
 * that failed is not "gone": it is tried again after a moment. A full picture the cache lets go of while it is wanted is
 * read again, without waiting for a change of zoom: the cache tells this node (onFullDropped), since the canvas keeps what it
 * drew and doesn't draw a node again by itself.
 */
function usePicture(sha256: string | null, wanted: PictureLevel): { image: HTMLImageElement | null | undefined; level: PictureLevel } {
  const file = projectStore.getState().project?.file;
  const [, setTick] = useState(0);
  const [gone, setGone] = useState<{ sha: string; at: number } | null>(null);
  const [retry, setRetry] = useState(0);
  // Forgotten pictures (Empty Trash, Clean up) are read again, or found gone.
  const forgotten = useDecodedGeneration();
  const missingFull = file !== undefined && sha256 !== null && wanted === 'original' && decodedPicture(file, sha256, 'original') === undefined;
  // Told when the cache lets this picture's full size go, so the node draws again and asks for it.
  useEffect(() => {
    if (sha256 === null || wanted !== 'original') return;
    return onFullDropped(sha256, () => {
      setTick((n) => n + 1);
    });
  }, [sha256, wanted]);
  useEffect(() => {
    if (!file || sha256 === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (level: PictureLevel) =>
      loadPicture(file, sha256, level).then((result) => {
        if (!live) return;
        if (result.status === 'ok') setTick((n) => n + 1);
        else if (result.status === 'gone') {
          if (level === 'thumbnail') setGone({ sha: sha256, at: forgotten });
        } else {
          timer = setTimeout(() => {
            setRetry((n) => n + 1);
          }, RETRY_MS);
        }
      });
    if (decodedPicture(file, sha256, 'thumbnail') === undefined) void ask('thumbnail');
    if (wanted === 'original' && decodedPicture(file, sha256, 'original') === undefined) void ask('original');
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // missingFull: the cache let a shown full picture go, so it is asked for again.
  }, [file, sha256, wanted, retry, missingFull, forgotten]);
  if (!file || sha256 === null || (gone?.sha === sha256 && gone.at === forgotten)) return { image: null, level: 'thumbnail' };
  const full = wanted === 'original' ? decodedPicture(file, sha256, 'original') : undefined;
  if (full) return { image: full, level: 'original' };
  return { image: decodedPicture(file, sha256, 'thumbnail'), level: 'thumbnail' };
}

/**
 * How a picture sits in its box (5.4): stretched to it (a picture card, whose box has the picture's shape), covering it with a
 * frame's crop (a shot card: the frame's own picture, as the storyboard crops it), or fitted whole inside it (a logo).
 */
export type PictureFit = { kind: 'stretch' } | { kind: 'cover'; crop?: Crop } | { kind: 'contain' };

export function PictureNode({
  id,
  sha256,
  width,
  height,
  zoom,
  inView,
  colours,
  fit = { kind: 'stretch' },
  crop = null,
  cutAway = false,
}: {
  id: string;
  sha256: string | null;
  width: number;
  height: number;
  zoom: number;
  inView: boolean;
  colours: CanvasColours;
  fit?: PictureFit;
  /** A picture card's kept part (6.5.7b), the box being that part; null for the whole picture. */
  crop?: CropRect | null;
  /**
   * The part a crop drag is cutting, alone and dimmed round the box (round 2): drawn in the item's `beyond` group, so the
   * handles never take it in. It says nothing of the size drawn: the picture in the box does.
   */
  cutAway?: boolean;
}) {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  // The whole picture's place in the box: its size on screen, uncropped, decides which size is read (6.5.7b).
  const whole = crop ? wholePicture(width, height, crop) : null;
  const { image, level } = usePicture(sha256, levelFor(whole?.width ?? width, whole?.height ?? height, zoom, ratio, inView));
  const shown = image ?? null;
  // Which stored picture this is, on the node itself, so a PDF export can draw its original instead of what the canvas holds (5.6a).
  const marked = { name: 'sb-picture', sbSha: sha256 ?? '' };
  useEffect(() => {
    if (cutAway) return;
    report(id, shown ? level : null);
    return () => {
      report(id, null);
    };
  }, [id, level, shown, cutAway]);
  // Gone: the condition that draws the "no longer in the project" words below.
  const gone = image === null;
  useEffect(() => {
    if (cutAway) return;
    reportGone(id, gone);
    return () => {
      reportGone(id, false);
    };
  }, [id, gone, cutAway]);
  if (cutAway) return shown && whole ? <KonvaImage image={shown} x={whole.x} y={whole.y} width={whole.width} height={whole.height} opacity={CUT_OPACITY} listening={false} /> : null;
  if (shown && fit.kind === 'cover') {
    const box = cropBox(fit.crop ?? DEFAULT_CROP, shown.naturalWidth / shown.naturalHeight, width / height);
    return (
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        <KonvaImage image={shown} x={(box.left / 100) * width} y={(box.top / 100) * height} width={(box.width / 100) * width} height={(box.height / 100) * height} listening={false} {...marked} />
      </Group>
    );
  }
  if (shown && fit.kind === 'contain') {
    const scale = Math.min(width / shown.naturalWidth, height / shown.naturalHeight);
    const w = shown.naturalWidth * scale;
    const h = shown.naturalHeight * scale;
    return <KonvaImage image={shown} x={(width - w) / 2} y={(height - h) / 2} width={w} height={h} listening={false} {...marked} />;
  }
  if (shown && crop) {
    // Cropped (6.5.7b round 2): the kept part alone, in the box, by Konva's own crop of the picture's pixels, so nothing
    // reaches past the box for the handles to frame. Its fractions ride on the node (`sbCrop`) for the PDF, which embeds
    // that part alone from the full-quality picture.
    const source = { x: crop.x * shown.naturalWidth, y: crop.y * shown.naturalHeight, width: crop.width * shown.naturalWidth, height: crop.height * shown.naturalHeight };
    return <KonvaImage image={shown} width={width} height={height} crop={source} listening={false} {...marked} {...{ sbCrop: { ...crop } }} />;
  }
  if (shown) return <KonvaImage image={shown} width={width} height={height} listening={false} {...marked} />;
  return (
    <>
      <Rect width={width} height={height} fill={colours.raised} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} dash={image === null ? [6, 4] : []} />
      {image === null && (
        <Text text={t('moodboard.pictureGone')} width={width} height={height} align="center" verticalAlign="middle" padding={8} fontFamily='"Inter Tight"' fontSize={Math.max(10, Math.min(18, width / 12))} fill={colours.ink} listening={false} />
      )}
    </>
  );
}
