import { labels, t } from '../../core/i18n';
import { paletteOf } from '../../core/model/palette';
import type { Paper } from '../../core/model/paper';
import type { SbdRecord } from '../../core/model/record';
import { sceneLabel } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { MIN_SIZE, tidy } from '../../ui/canvas/placement';
import { board } from '../storyboard/board';
import { deckBoardChange } from './boards';
import { createItems, estimateTextHeight, type ItemSeed, type MeasureText } from './items';
import { designSize, type LiveKind } from './liveCards';
import { PAGE_GAP, pageSize, type DeckField, type PageFormat, type PageOrientation } from './pageFormats';
import { pageSeed } from './pages';

// The four deck templates (5.5, decision 8) and the blank deck: each is made in one op group as a new deck, its pages laid
// left to right 200 units apart. A template is a layout of page frames, text headings and cards, all read from the project
// as it is now: the title, logline and the rest are field cards (they stay in step with Settings), the scenes and shots are
// live cards (5.4). The headings are plain text boxes written in the language in use when the deck is made: authored
// content a person can change, which never changes with the language afterwards. An empty project still makes a sensible
// deck: a title page and the placeholders.

type Records = Readonly<Record<string, SbdRecord>>;

export const DECK_TEMPLATES = ['blank', 'treatment', 'lookbook', 'pitch', 'shotlist'] as const;
export type DeckTemplate = (typeof DECK_TEMPLATES)[number];
export const DECK_TEMPLATE_LABEL: Readonly<Record<DeckTemplate, string>> = labels({
  blank: 'deck.template.blank',
  treatment: 'deck.template.treatment',
  lookbook: 'deck.template.lookbook',
  pitch: 'deck.template.pitch',
  shotlist: 'deck.template.shotlist',
});
export const isDeckTemplate = (value: unknown): value is DeckTemplate => typeof value === 'string' && (DECK_TEMPLATES as readonly string[]).includes(value);

/** At most this many scenes get a page in a Lookbook. */
export const LOOKBOOK_SCENES = 12;
/** Four scene cards fit a Treatment page; six shot cards (3 × 2) a Shot list page. */
export const SCENES_PER_TREATMENT_PAGE = 4;
export const SHOTS_PER_LIST_PAGE = 6;

export interface TemplateOptions {
  template: DeckTemplate;
  name: string;
  /** Treatment and Shot list print on this paper (Letter or A4 by region, or the app's paper setting). */
  paper: Paper;
  /** Blank: the one page's format. */
  format?: PageFormat;
  orientation?: PageOrientation;
  measure?: MeasureText;
}

/** One page being laid out: items are placed relative to its top left corner and moved into the world once the pages are placed. */
interface PageSpec {
  format: PageFormat;
  orientation: PageOrientation;
  name: string;
  items: ItemSeed[];
}

class Layout {
  readonly pages: PageSpec[] = [];
  constructor(private readonly measure: MeasureText) {}

  page(format: PageFormat, orientation: PageOrientation, name: string): PageSpec {
    const spec: PageSpec = { format, orientation, name, items: [] };
    this.pages.push(spec);
    return spec;
  }

  /** A heading, a plain text box as tall as its words. */
  heading(page: PageSpec, text: string, x: number, y: number, width: number, size = 44, weight = 700): void {
    const seed: ItemSeed = { kind: 'text', x, y, width, height: MIN_SIZE, rotation: 0, text, fontSize: size, fontWeight: weight };
    const height = Math.max(MIN_SIZE, this.measure({ text, fontFamily: 'Inter Tight', fontWeight: weight, fontItalic: false, fontSize: size, align: 'left', width }));
    page.items.push({ ...seed, height });
  }

  /** A live field card: the project's words, in a box. */
  field(page: PageSpec, field: DeckField, x: number, y: number, width: number, height: number, size: number, weight = 400): void {
    page.items.push({ kind: 'field_card', field, x, y, width, height, rotation: 0, fontSize: size, fontWeight: weight });
  }

  /** A live card at a scale of its design size. */
  card(page: PageSpec, kind: LiveKind, ref: { shotId?: string; sceneId?: string }, x: number, y: number, k: number): { width: number; height: number } {
    const design = designSize(kind);
    const size = { width: Math.round(design.width * k), height: Math.round(design.height * k) };
    page.items.push({ kind, x, y, ...size, rotation: 0, ...(ref.shotId ? { shotId: ref.shotId } : {}), ...(ref.sceneId ? { sceneId: ref.sceneId } : {}) });
    return size;
  }
}

/** The title page every template but Shot list opens with: title, logline and company, as field cards. */
function titlePage(layout: Layout, format: PageFormat, orientation: PageOrientation): PageSpec {
  const page = layout.page(format, orientation, t('deck.page.title'));
  const { width, height } = pageSize(format, orientation);
  const margin = Math.round(width * 0.07);
  const inner = width - margin * 2;
  const top = Math.round(height * 0.28);
  layout.field(page, 'title', margin, top, inner, Math.round(width * 0.12), Math.round(width * 0.045), 700);
  layout.field(page, 'logline', margin, top + Math.round(width * 0.16), inner, Math.round(width * 0.14), Math.round(width * 0.019));
  layout.field(page, 'company', margin, height - Math.round(width * 0.09), inner, Math.round(width * 0.03), Math.round(width * 0.015), 700);
  return page;
}

const hasPalette = (scene: ReturnType<typeof board>[number]): boolean => (paletteOf(scene.record.props)?.colors.length ?? 0) > 0;

function treatment(layout: Layout, scenes: ReturnType<typeof board>, paper: Paper): void {
  const format: PageFormat = paper;
  const portrait: PageOrientation = 'portrait';
  const { width, height } = pageSize(format, portrait);
  const margin = 100;
  const inner = width - margin * 2;
  titlePage(layout, format, portrait);
  const facts = layout.page(format, portrait, t('deck.page.format'));
  layout.heading(facts, t('deck.field.format'), margin, 160, inner, 28);
  layout.field(facts, 'format', margin, 210, inner, 70, 44);
  layout.heading(facts, t('deck.field.runtime'), margin, 380, inner, 28);
  layout.field(facts, 'runtime', margin, 430, inner, 70, 44);
  const cast = layout.page(format, portrait, t('deck.page.characters'));
  layout.heading(cast, t('deck.heading.characters'), margin, 100, inner, 56);
  layout.field(cast, 'cast', margin, 210, inner, height - 210 - margin, 30);
  for (let from = 0; from < scenes.length; from += SCENES_PER_TREATMENT_PAGE) {
    const page = layout.page(format, portrait, t('deck.page.scenes'));
    layout.heading(page, t('deck.heading.scenes'), margin, 100, inner, 56);
    scenes.slice(from, from + SCENES_PER_TREATMENT_PAGE).forEach((scene, i) => {
      const column = i % 2;
      const row = Math.floor(i / 2);
      const size = designSize('scene_card');
      layout.card(page, 'scene_card', { sceneId: scene.record.id }, margin + column * (size.width + (inner - 2 * size.width)), 240 + row * (size.height + 80), 1);
    });
  }
}

function lookbook(layout: Layout, scenes: ReturnType<typeof board>): void {
  const format: PageFormat = '16:9';
  const portrait: PageOrientation = 'portrait';
  titlePage(layout, format, portrait);
  const k = 1.25;
  for (const scene of scenes.slice(0, LOOKBOOK_SCENES)) {
    const page = layout.page(format, portrait, sceneLabel(scene.fields.number));
    const sceneSize = layout.card(page, 'scene_card', { sceneId: scene.record.id }, 80, 80, k);
    // Every scene page has its palette card: it is live, so a palette made later appears, and an empty one draws nothing in a presentation.
    layout.card(page, 'palette_card', { sceneId: scene.record.id }, 80, 80 + sceneSize.height + 50, k);
    // Up to four shot cards, two by two, in even rows.
    const shot = designSize('shot_card');
    const cell = { width: Math.round(shot.width * k), height: Math.round(shot.height * k) };
    scene.shots.slice(0, 4).forEach((frame, i) => {
      layout.card(page, 'shot_card', { shotId: frame.record.id }, 760 + (i % 2) * (cell.width + 40), 80 + Math.floor(i / 2) * (cell.height + 40), k);
    });
  }
  const closing = layout.page(format, portrait, t('deck.page.closing'));
  const brand = designSize('brand_card');
  const scale = 1.5;
  layout.card(closing, 'brand_card', {}, Math.round((1920 - brand.width * scale) / 2), Math.round((1080 - brand.height * scale) / 2), scale);
}

function pitch(layout: Layout, scenes: ReturnType<typeof board>): void {
  const format: PageFormat = '16:9';
  const portrait: PageOrientation = 'portrait';
  titlePage(layout, format, portrait);
  const logline = layout.page(format, portrait, t('deck.page.logline'));
  layout.heading(logline, t('deck.heading.logline'), 120, 120, 1680, 40);
  layout.field(logline, 'logline', 120, 240, 1680, 600, 60);
  const team = layout.page(format, portrait, t('deck.page.team'));
  layout.heading(team, t('deck.heading.team'), 120, 100, 1680, 56);
  layout.field(team, 'crew', 120, 210, 1680, 800, 28);
  const look = layout.page(format, portrait, t('deck.page.look'));
  layout.heading(look, t('deck.heading.look'), 120, 100, 1680, 56);
  // The palettes of the first four scenes that have one.
  const withPalette = scenes.filter(hasPalette).slice(0, 4);
  withPalette.forEach((scene, i) => {
    layout.card(look, 'palette_card', { sceneId: scene.record.id }, 120 + i * (designSize('palette_card').width + 80), 260, 1);
  });
  const schedule = layout.page(format, portrait, t('deck.page.schedule'));
  layout.heading(schedule, t('deck.heading.schedule'), 120, 100, 1680, 56);
  layout.field(schedule, 'dates', 120, 230, 1680, 160, 56);
  const closing = layout.page(format, portrait, t('deck.page.closing'));
  const brand = designSize('brand_card');
  layout.card(closing, 'brand_card', {}, Math.round((1920 - brand.width * 1.5) / 2), Math.round((1080 - brand.height * 1.5) / 2), 1.5);
}

function shotList(layout: Layout, scenes: ReturnType<typeof board>, paper: Paper): void {
  const format: PageFormat = paper;
  const landscape: PageOrientation = 'landscape';
  const { width } = pageSize(format, landscape);
  const margin = 60;
  if (scenes.length === 0) {
    // Nothing in the storyboard yet: the title page stands in, with the placeholders.
    const page = layout.page(format, landscape, t('deck.page.title'));
    layout.field(page, 'title', margin, 200, width - margin * 2, 120, 64, 700);
    layout.heading(page, t('deck.heading.shotList'), margin, 360, width - margin * 2, 36);
    return;
  }
  const gap = 40;
  const cardWidth = Math.floor((width - margin * 2 - gap * 2) / 3);
  const k = cardWidth / designSize('shot_card').width;
  for (const scene of scenes) {
    const pages = Math.max(1, Math.ceil(scene.shots.length / SHOTS_PER_LIST_PAGE));
    for (let n = 0; n < pages; n += 1) {
      const label = sceneLabel(scene.fields.number);
      const page = layout.page(format, landscape, pages > 1 ? t('deck.page.sceneContinued', { scene: label, n: n + 1 }) : label);
      const top = layout.card(page, 'scene_card', { sceneId: scene.record.id }, margin, margin, 1.3);
      const rowHeight = Math.round(designSize('shot_card').height * k);
      scene.shots.slice(n * SHOTS_PER_LIST_PAGE, (n + 1) * SHOTS_PER_LIST_PAGE).forEach((frame, i) => {
        layout.card(page, 'shot_card', { shotId: frame.record.id }, margin + (i % 3) * (cardWidth + gap), margin + top.height + gap + Math.floor(i / 3) * (rowHeight + gap), k);
      });
    }
  }
}

/** The new deck: its board record and every page and item, ready to write as one op group. */
export function deckChanges(records: Records, projectId: string, options: TemplateOptions): { id: string; changes: Change[] } {
  const layout = new Layout(options.measure ?? estimateTextHeight);
  const scenes = board(records, projectId);
  let first: { format: PageFormat; orientation: PageOrientation };
  switch (options.template) {
    case 'treatment':
      treatment(layout, scenes, options.paper);
      first = { format: options.paper, orientation: 'portrait' };
      break;
    case 'lookbook':
      lookbook(layout, scenes);
      first = { format: '16:9', orientation: 'portrait' };
      break;
    case 'pitch':
      pitch(layout, scenes);
      first = { format: '16:9', orientation: 'portrait' };
      break;
    case 'shotlist':
      shotList(layout, scenes, options.paper);
      first = { format: options.paper, orientation: 'landscape' };
      break;
    default: {
      // Blank: one empty page in the chosen format.
      const format = options.format ?? '16:9';
      const orientation = options.orientation ?? 'portrait';
      layout.page(format, orientation, '');
      first = { format, orientation };
    }
  }
  const made = deckBoardChange(records, projectId, options.name, first.format, first.orientation);
  // The pages left to right, 200 apart and level at the top; each page's items move with it.
  const seeds: ItemSeed[] = [];
  const itemSeeds: ItemSeed[] = [];
  let x = 0;
  for (const spec of layout.pages) {
    const size = pageSize(spec.format, spec.orientation);
    seeds.push(pageSeed(spec.format, spec.orientation, { x, y: 0 }, spec.name));
    for (const item of spec.items) itemSeeds.push({ ...item, x: tidy(x + item.x), y: tidy(item.y) });
    x += size.width + PAGE_GAP;
  }
  const items = createItems(records, made.id, [...seeds, ...itemSeeds]);
  return { id: made.id, changes: [made.change, ...items.changes] };
}
