import { companyLogo } from '../../app/company/companyEdits';
import { getLocale, t, tn } from '../../core/i18n';
import { mediaFields } from '../../core/media/store';
import { DEFAULT_CROP, type Crop } from '../../core/media/crop';
import { cleanBrandColors, projectCompany, type ProjectCompany } from '../../core/model/company';
import { paletteOf } from '../../core/model/palette';
import type { SbdRecord } from '../../core/model/record';
import type { ShotStatus } from '../../core/model/shotStatus';
import { aspectRatioValue, choiceLabel, MOVE_LABEL, projectStoryboard, sceneFields, sceneLabel, shotFields, SHOT_SIZE_LABEL } from '../../core/model/storyboard';
import { boardScene } from '../storyboard/board';
import { pictureView } from '../storyboard/framePictures';
import { headingOf } from '../storyboard/ScenesView';
import { strokesByShot, type Stroke } from '../storyboard/sketch/strokes';

// Live cards (5.4, docs/SBD_FORMAT.md, Boards): board items that show a record of the project as it is now. A card stores
// only which record it shows (`shot_id`, `scene_id`) or nothing (the brand kit reads the project's company); everything
// drawn is read here each time, so the board never holds a copy that could go stale (CLAUDE.md: views read records).

type Records = Readonly<Record<string, SbdRecord>>;

export const LIVE_KINDS = ['shot_card', 'scene_card', 'palette_card', 'brand_card'] as const;
export type LiveKind = (typeof LIVE_KINDS)[number];
export const isLiveKind = (kind: string): kind is LiveKind => (LIVE_KINDS as readonly string[]).includes(kind);

/** What a live card is told about itself: its kind and the record it names ('' for none). */
export interface LiveRef {
  kind: LiveKind;
  shotId: string;
  sceneId: string;
}

/** A frame or scene a card names that is in the Trash, or gone for good (Empty Trash). Neither is an error. */
export type LiveState = 'live' | 'trash' | 'gone';

export interface ShotCardData {
  kind: 'shot_card';
  state: LiveState;
  /** The number on the slate, exactly as the storyboard shows it ('' for an unnumbered frame). */
  number: string;
  /** "MCU", "50mm", "Dolly": what is set, in the language in use; the shot size and lens as mono values. */
  size: string;
  lens: string;
  /** The lens in mm, for what is read aloud. */
  lensMm: number | null;
  move: string;
  status: ShotStatus;
  /** The frame's stored picture, null for none; the picture the storyboard draws, not a copy. */
  sha256: string | null;
  crop: Crop;
  strokes: readonly Stroke[];
  /** The project's frame shape (width over height). */
  aspect: number;
}

export interface SceneFrameThumb {
  id: string;
  number: string;
  sha256: string | null;
  crop: Crop;
}

export interface SceneCardData {
  kind: 'scene_card';
  state: LiveState;
  /** "SC 04" and the heading as the board shows it ("INT. KITCHEN — NIGHT"). */
  label: string;
  heading: string;
  frames: number;
  /** The first four frames, in board order. */
  first: SceneFrameThumb[];
  aspect: number;
}

export interface PaletteCardData {
  kind: 'palette_card';
  state: LiveState;
  label: string;
  heading: string;
  /** The scene's palette, in its order, `#RRGGBB`; empty when it has none. */
  colors: string[];
  sceneId: string;
}

export interface BrandCardData {
  kind: 'brand_card';
  company: ProjectCompany | null;
  /** The stored picture of the company's logo in the project, null for none. */
  logoSha256: string | null;
  colors: string[];
  fonts: string[];
}

export type LiveCardData = ShotCardData | SceneCardData | PaletteCardData | BrandCardData;

const stateOf = (record: SbdRecord | undefined, type: SbdRecord['type']): LiveState =>
  record?.type !== type ? 'gone' : record.trashedAt !== null ? 'trash' : 'live';

/** The project a board item sits in: its board's parent. */
export function projectIdOf(records: Records, itemId: string): string | null {
  const board = records[records[itemId]?.parentId ?? ''];
  return board?.type === 'board' ? board.parentId : null;
}

/** The project's frame shape. */
function aspectOf(records: Records, projectId: string | null): number {
  return aspectRatioValue(projectStoryboard(projectId ? records[projectId]?.props : undefined).aspectRatio);
}

/** Every shot's strokes, worked out once per version of the records (the store makes a new object for each change). */
const strokeIndex = new WeakMap<Records, Map<string, Stroke[]>>();
const strokesOfShot = (records: Records, shotId: string): Stroke[] => {
  let index = strokeIndex.get(records);
  if (!index) {
    index = strokesByShot(records);
    strokeIndex.set(records, index);
  }
  return index.get(shotId) ?? [];
};

/**
 * What a live card draws, read from the project as it is now. Worked out once per card per version of the records, so the
 * drawing, the live region and the strip share one answer.
 */
const dataCache = new WeakMap<Records, Map<string, LiveCardData>>();
export function liveCardData(records: Records, projectId: string | null, ref: LiveRef, locale: string = getLocale()): LiveCardData {
  let cached = dataCache.get(records);
  if (!cached) {
    cached = new Map();
    dataCache.set(records, cached);
  }
  // The language is in the key: the data holds words ("SC 04", "50MM", the move's label).
  const key = `${locale}|${projectId ?? ''}|${ref.kind}|${ref.shotId}|${ref.sceneId}`;
  let data = cached.get(key);
  if (!data) {
    data = readLiveCard(records, projectId, ref);
    cached.set(key, data);
  }
  return data;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function readLiveCard(records: Records, projectId: string | null, ref: LiveRef): LiveCardData {
  if (ref.kind === 'shot_card') {
    const shot = records[ref.shotId];
    const state = stateOf(shot, 'shot');
    const fields = shot && state !== 'gone' ? shotFields(shot.props) : null;
    const picture = fields ? pictureView(records, fields) : null;
    return {
      kind: 'shot_card',
      state,
      number: fields?.number ?? '',
      size: fields?.size ? SHOT_SIZE_LABEL[fields.size] : '',
      // As the storyboard has them: the lens as its frame card ("50MM"), the move as its shot list ("Push in").
      lens: fields?.lensMm == null ? '' : t('spec.lens', { mm: fields.lensMm }),
      lensMm: fields?.lensMm ?? null,
      move: fields?.move ? capital(choiceLabel(MOVE_LABEL, fields.move)) : '',
      status: fields?.status ?? 'need',
      sha256: picture && picture.sha256 !== '' ? picture.sha256 : null,
      crop: fields?.crop ?? DEFAULT_CROP,
      strokes: fields ? strokesOfShot(records, ref.shotId) : [],
      aspect: aspectOf(records, projectId),
    };
  }
  if (ref.kind === 'scene_card' || ref.kind === 'palette_card') {
    const scene = records[ref.sceneId];
    const state = stateOf(scene, 'scene');
    const fields = scene && state !== 'gone' ? sceneFields(scene.props) : null;
    const label = fields ? sceneLabel(fields.number) : '';
    const heading = fields ? headingOf(fields) : '';
    if (ref.kind === 'palette_card') {
      return { kind: 'palette_card', state, label, heading, colors: scene && state !== 'gone' ? (paletteOf(scene.props)?.colors.map((c) => c.hex) ?? []) : [], sceneId: ref.sceneId };
    }
    const shots = scene && state !== 'gone' ? boardScene(records, scene).shots : [];
    return {
      kind: 'scene_card',
      state,
      label,
      heading,
      frames: shots.length,
      first: shots.slice(0, 4).map((shot) => {
        const picture = pictureView(records, shot.fields);
        return { id: shot.record.id, number: shot.fields.number, sha256: picture && picture.sha256 !== '' ? picture.sha256 : null, crop: shot.fields.crop };
      }),
      aspect: aspectOf(records, projectId),
    };
  }
  const company = projectCompany(projectId ? records[projectId]?.props : undefined);
  const logo = company && projectId ? companyLogo(records, projectId, company.logoId) : null;
  return {
    kind: 'brand_card',
    company,
    logoSha256: logo ? (mediaFields(logo.props)?.sha256 ?? null) : null,
    colors: company ? cleanBrandColors(company.brandColors) : [],
    fonts: company?.brandFonts ?? [],
  };
}

/** The Trash and gone words a card shows in place of its record. */
export function stateWords(kind: LiveKind, state: LiveState): string {
  if (state === 'trash') return t('moodboard.live.inTrash');
  if (state === 'gone') return kind === 'scene_card' || kind === 'palette_card' ? t('moodboard.live.sceneRemoved') : t('moodboard.live.shotRemoved');
  return '';
}

/** What a screen reader hears for a live card: "Shot card 4A, MCU, 50 mm", "Scene card SC 04 …", then its state. */
export function liveLabel(data: LiveCardData): string {
  switch (data.kind) {
    case 'shot_card': {
      if (data.state === 'gone') return `${t('moodboard.item.shot_card')}: ${stateWords('shot_card', 'gone')}`;
      const number = data.number === '' ? t('history.aFrame') : data.number;
      const details = [data.size, data.lensMm === null ? '' : t('moodboard.live.lensMm', { mm: data.lensMm }), data.move].filter((part) => part !== '').join(', ');
      const base = details === '' ? t('moodboard.announce.shotCard', { number }) : t('moodboard.announce.shotCardWith', { number, details });
      return data.state === 'trash' ? `${base}, ${stateWords('shot_card', 'trash')}` : base;
    }
    case 'scene_card': {
      if (data.state === 'gone') return `${t('moodboard.item.scene_card')}: ${stateWords('scene_card', 'gone')}`;
      const base = t('moodboard.announce.sceneCard', { heading: `${data.label} ${data.heading}`.trim(), frames: tn('count.frames', data.frames) });
      return data.state === 'trash' ? `${base}, ${stateWords('scene_card', 'trash')}` : base;
    }
    case 'palette_card': {
      if (data.state === 'gone') return `${t('moodboard.item.palette_card')}: ${stateWords('palette_card', 'gone')}`;
      const base = t('moodboard.announce.paletteCard', { heading: `${data.label} ${data.heading}`.trim(), colors: tn('count.colors', data.colors.length) });
      return data.state === 'trash' ? `${base}, ${stateWords('palette_card', 'trash')}` : base;
    }
    case 'brand_card':
      return data.company ? t('moodboard.announce.brandCard', { name: data.company.name || t('company.unnamed') }) : t('moodboard.announce.brandCardNone');
  }
}

// What a card is drawn on: a fixed design in world units that scales to the card's box, so resizing keeps its look.
export const SHOT_CARD_WIDTH = 320;
export const SHOT_FOOTER = 64;
export const SCENE_CARD_WIDTH = 480;
export const SCENE_HEADER = 76;
export const SCENE_GAP = 12;
export const PALETTE_CARD_WIDTH = 360;
export const PALETTE_HEADER = 64;
export const PALETTE_COLUMNS = 4;
export const PALETTE_CELL = 88;
export const BRAND_CARD_WIDTH = 360;
export const BRAND_LOGO_HEIGHT = 84;
export const BRAND_NAME_HEIGHT = 36;
export const BRAND_FONT_LINE = 34;

/** The picture area of a shot or scene card is always 16:9; a frame of another shape is letterboxed inside it. */
export const PICTURE_ASPECT = 16 / 9;

/**
 * A card's design size: ONE per kind, whose shape never depends on what the card shows, so a card is never drawn smaller in
 * its box because its content grew. A palette has room for 16 colours (4 rows), the brand kit for 8 colours and 3 fonts, and a
 * shot or scene card has a 16:9 picture area with the frame letterboxed inside it.
 */
export function designSize(kind: LiveKind): { width: number; height: number } {
  switch (kind) {
    case 'shot_card':
      return { width: SHOT_CARD_WIDTH, height: Math.round(SHOT_CARD_WIDTH / PICTURE_ASPECT) + SHOT_FOOTER };
    case 'scene_card': {
      const cell = (SCENE_CARD_WIDTH - SCENE_GAP * 5) / 4;
      return { width: SCENE_CARD_WIDTH, height: SCENE_HEADER + Math.round(cell / PICTURE_ASPECT) + SCENE_GAP * 2 };
    }
    case 'palette_card':
      return { width: PALETTE_CARD_WIDTH, height: PALETTE_HEADER + 4 * PALETTE_CELL + 12 };
    case 'brand_card':
      return { width: BRAND_CARD_WIDTH, height: 12 + BRAND_LOGO_HEIGHT + 8 + BRAND_NAME_HEIGHT + 2 * PALETTE_CELL + 8 + 3 * BRAND_FONT_LINE + 8 + 12 };
  }
}

/** How much a card's design is scaled to fill its box: 1 for a card at the size it was made, whatever it shows. */
export function drawScale(kind: LiveKind, width: number, height: number): number {
  const design = designSize(kind);
  return Math.min(width / design.width, height / design.height);
}

/** The largest box of a frame's shape (width over height) that fits inside a picture area, centred in it. */
export function letterbox(aspect: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : PICTURE_ASPECT;
  const w = Math.min(width, height * safe);
  const h = w / safe;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

/** The records an Add-from-storyboard picker lists: scenes in order, each with its live frames. */
export interface PickScene {
  id: string;
  label: string;
  heading: string;
  /** `position` is its place in the scene (1 is first), to name a frame that has no number yet. */
  frames: { id: string; number: string; position: number }[];
}

/**
 * Scenes in board order with their frames, searched by scene number, heading or shot number (case and spaces ignored). A
 * scene that matches by its own number or heading lists all its frames; otherwise only the frames whose number matches.
 */
export function pickScenes(scenes: readonly { record: SbdRecord; shots: readonly { record: SbdRecord; fields: { number: string } }[] }[], query: string): PickScene[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, '');
  const squash = (text: string) => text.toLowerCase().replace(/\s+/g, '');
  return scenes.flatMap((scene) => {
    const fields = sceneFields(scene.record.props);
    const label = sceneLabel(fields.number);
    const heading = headingOf(fields);
    const frames = scene.shots.map((shot, i) => ({ id: shot.record.id, number: shot.fields.number, position: i + 1 }));
    if (needle === '') return [{ id: scene.record.id, label, heading, frames }];
    const sceneHit = [fields.number, label, `sc${fields.number}`, heading].some((text) => squash(text).includes(needle));
    if (sceneHit) return [{ id: scene.record.id, label, heading, frames }];
    const hits = frames.filter((frame) => squash(frame.number).includes(needle));
    return hits.length > 0 ? [{ id: scene.record.id, label, heading, frames: hits }] : [];
  });
}
