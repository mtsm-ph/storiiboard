import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../../app/projectStore';
import { setLocale } from '../../../core/i18n';
import { sceneRoomId, startRoomChanges, wallsAlong, type IconFields, type MeasureFields } from '../../../core/model/plan';
import { nodeDriver } from '../../../core/storage/nodeDriver';
import { createProject, type Project } from '../../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../../core/storage/testFolder';
import { contrastRatio, DARK_COLOURS } from '../../../ui/canvas/canvasPalette';
import { DEPT_LIGHTING, INK, PAPER, PAPER_COLOURS, RAISED } from '../../../ui/canvas/paperColours';
import type { CanvasColours, DrawContext } from '../../../ui/canvas/types';
import { labelHalo } from './cameraDraw';
import type { IconPath } from './iconBoxes';
import { DARK_OUTLINE, iconNodes, iconNodesWith, iconPathNode } from './iconDraw';
import { iconItem, measureItem, planCanvasItems } from './planItems';

// The plan in the Dark view (6.5.1, Kevin, Nov 16): what has no colour of its own (a wall, an icon's ink, a note's words, an
// outline, a measure, a label's halo) is drawn in the dark palette's light ink on its dark page; a colour of the kit's own
// (a department's, golden hour's) is drawn as it is; on paper everything is exactly as before.

type Props = Record<string, unknown>;
const propsOf = (node: ReactNode): Props => (isValidElement(node) ? (node.props as Props) : {});

/** Every Konva element a drawing makes, function components called one level at a time (none here has hooks but an icon's text). */
function flat(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => flat(n));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Props>;
  if (typeof el.type === 'function') {
    // An icon's text is a component with hooks: kept as the element, its part and palette in its props.
    if (el.props.part !== undefined) return [el];
    return flat((el.type as (p: Props) => ReactNode)(el.props));
  }
  return [el, ...flat(el.props.children as ReactNode)];
}

const context = (colours: CanvasColours, width: number, height: number): DrawContext => ({ colours, zoom: 1, inView: true, width, height });

const icon = (id: string, name = ''): IconFields => ({ kind: 'icon', icon: id, x: 0, y: 0, width: 1, height: 0.6, rotation: 0, heightM: null, name });

describe('a plan icon in the Dark view', () => {
  it('draws only the kit’s ink lines in the light ink, keeping every fill the kit’s (round 3)', () => {
    // A stroke-only icon is all light.
    const zone = flat(iconNodes('production/zone', DARK_COLOURS)).map(propsOf);
    for (const part of zone) {
      expect(part.stroke).toBe(DARK_COLOURS.ink);
      expect(part).not.toHaveProperty('fill');
    }
    // The sofa's seat keeps the kit's green; its outline is the light ink.
    const sofa = flat(iconNodes('set-art/sofa', DARK_COLOURS)).map(propsOf);
    expect(sofa[0]).toMatchObject({ fill: '#8FA38E', stroke: DARK_COLOURS.ink });
    // A lamp's mustard is the lighting department's colour, never swapped.
    const fresnel = flat(iconNodes('lighting/fresnel', DARK_COLOURS)).map(propsOf);
    expect(fresnel[0]).toMatchObject({ fill: DEPT_LIGHTING, stroke: DARK_COLOURS.ink });
    // A bounce's face is still white, its outline light.
    const bounce = flat(iconNodes('grip/bounce', DARK_COLOURS)).map(propsOf);
    expect(bounce[0]).toMatchObject({ fill: '#FFFFFF', stroke: DARK_COLOURS.ink });
    // A flag is black cloth: its fill still ink, its outline (the kit's own line) light, so it reads on the dark page.
    const flag = flat(iconNodes('grip/flag', DARK_COLOURS)).map(propsOf);
    expect(flag[0]).toMatchObject({ fill: INK, stroke: DARK_COLOURS.ink, strokeWidth: 1.5 });
    // An apple box's oatmeal stays oatmeal.
    expect(flat(iconNodes('grip/apple-box', DARK_COLOURS)).map(propsOf)[0]).toMatchObject({ fill: RAISED, stroke: DARK_COLOURS.ink });
  });

  it('draws an ink line over one of the icon’s own fills in the ink that reads on it, and a line beside a fill light (round 4)', () => {
    const lines = (id: string) => flat(iconNodes(id, DARK_COLOURS)).map(propsOf);
    // A bounce's centre line on its white face: ink, at the kit's 30%; its outline light.
    const bounce = lines('grip/bounce');
    expect(bounce[0]).toMatchObject({ fill: '#FFFFFF', stroke: DARK_COLOURS.ink });
    expect(bounce[1]).toMatchObject({ stroke: 'rgba(22, 21, 15, 0.3)' });
    // An apple box's handles on its oatmeal: ink.
    const apple = lines('grip/apple-box');
    expect(apple[1]).toMatchObject({ stroke: INK });
    expect(apple[2]).toMatchObject({ stroke: INK });
    expect(contrastRatio(INK, RAISED)).toBeGreaterThanOrEqual(4.5);
    // The sofa: its cushion lines on the green seat ink (at the kit's 45%), its back above the seat light.
    const sofa = lines('set-art/sofa');
    expect(sofa[2]).toMatchObject({ stroke: 'rgba(22, 21, 15, 0.45)' });
    expect(sofa[1]).toMatchObject({ stroke: DARK_COLOURS.ink, strokeWidth: 3 });
    // A fresnel: its lens ring inside the lamp ink, its rays outside the lamp light, though drawn after its fill.
    const fresnel = lines('lighting/fresnel');
    expect(fresnel[1]).toMatchObject({ stroke: INK });
    expect(fresnel[2]).toMatchObject({ stroke: DARK_COLOURS.ink });
    // On paper, every line is the kit's own.
    expect(flat(iconNodes('grip/bounce')).map(propsOf)[1]).toMatchObject({ stroke: 'rgba(22, 21, 15, 0.3)' });
    expect(flat(iconNodes('set-art/sofa')).map(propsOf)[1]).toMatchObject({ stroke: INK });
  });

  it('gives a solid ink fill with no line of its own a light outline at the kit’s weight in Dark, none on paper', () => {
    // The kit has no such shape today; a table entry like one, drawn through the same node maker.
    const solid: IconPath = { kind: 'path', d: 'M0 0L10 0L10 10Z', fill: INK, fillOpacity: 1, stroke: null, strokeOpacity: 1, strokeWidth: 1.5, dash: null, lineCap: 'round', lineJoin: 'round', opacity: 1 };
    expect(propsOf(iconPathNode(solid, 'a', DARK_COLOURS))).toMatchObject({ fill: INK, stroke: DARK_COLOURS.ink, strokeWidth: DARK_OUTLINE });
    expect(propsOf(iconPathNode(solid, 'a', PAPER_COLOURS))).not.toHaveProperty('stroke');
    expect(propsOf(iconPathNode({ ...solid, fill: '#FFFFFF' }, 'a', DARK_COLOURS))).not.toHaveProperty('stroke');
  });

  it('keeps the kit’s own hexes on paper, the very nodes it always shared', () => {
    expect(iconNodes('grip/bounce', PAPER_COLOURS)).toBe(iconNodes('grip/bounce'));
    const bounce = flat(iconNodes('grip/bounce', PAPER_COLOURS)).map(propsOf);
    expect(bounce[0]).toMatchObject({ fill: '#FFFFFF', stroke: INK });
    // Dark has nodes of its own, made once and shared too.
    expect(iconNodes('grip/bounce', DARK_COLOURS)).not.toBe(iconNodes('grip/bounce'));
    expect(iconNodes('grip/bounce', DARK_COLOURS)).toBe(iconNodes('grip/bounce', DARK_COLOURS));
    expect(iconNodesWith('cast/cast-mark', undefined, DARK_COLOURS)).toBe(iconNodes('cast/cast-mark', DARK_COLOURS));
  });

  it('sets an icon’s letter on no fill in the light ink, its part still the table’s for a print', () => {
    const [, letter] = iconNodes('production/parking', DARK_COLOURS) ?? [];
    expect(propsOf(letter).ink).toBe(DARK_COLOURS.ink);
    const [, paperLetter] = iconNodes('production/parking') ?? [];
    expect(propsOf(paperLetter).ink).toBeUndefined();
    expect(propsOf(letter).part).toBe(propsOf(paperLetter).part);
  });

  it('sets a cast mark’s letters in ink on its pink in Dark, readable (contrast 4.5 or more), a renamed mark’s too', () => {
    const [disc, letters] = iconNodes('cast/cast-mark', DARK_COLOURS) ?? [];
    const pink = propsOf(disc).fill as string;
    expect(pink).toBe('#E9B8A6');
    expect(propsOf(letters).ink).toBe(INK);
    expect(contrastRatio(propsOf(letters).ink as string, pink)).toBeGreaterThanOrEqual(4.5);
    // The light ink would not do: it is why the rule is there.
    expect(contrastRatio(DARK_COLOURS.ink, pink)).toBeLessThan(4.5);
    const [, renamed] = iconNodesWith('cast/cast-mark', 'B1', DARK_COLOURS) ?? [];
    expect(propsOf(renamed)).toMatchObject({ ink: INK, part: { text: 'B1' } });
    // On paper the kit's own fill, no ink given.
    const [, paperLetters] = iconNodesWith('cast/cast-mark', 'B1') ?? [];
    expect(propsOf(paperLetters).ink).toBeUndefined();
  });

  it('keeps a note’s oatmeal in Dark, its words in the ink that reads on it and its outline light; a name under an icon light', () => {
    const note = iconItem('n', icon('production/note', 'Craft services'), 'metres');
    const dark = flat(note.draw?.(context(DARK_COLOURS, note.width, note.height))).map(propsOf);
    expect(dark.find((p) => p.text === 'Craft services')).toMatchObject({ fill: INK });
    expect(dark.find((p) => p.stroke !== undefined && p.text === undefined)).toMatchObject({ fill: RAISED, stroke: DARK_COLOURS.ink });
    const paper = flat(note.draw?.(context(PAPER_COLOURS, note.width, note.height))).map(propsOf);
    expect(paper.find((p) => p.text === 'Craft services')).toMatchObject({ fill: INK });
    expect(paper.find((p) => p.stroke !== undefined && p.text === undefined)).toMatchObject({ fill: RAISED, stroke: INK });
    // An icon this version doesn't have: its default outline and "?" in the light ink.
    const odd = iconItem('o', icon('set-art/hovercraft', 'Hover'), 'metres');
    const drawn = flat(odd.draw?.({ ...context(DARK_COLOURS, odd.width, odd.height), zoom: 1 })).map(propsOf);
    expect(drawn.find((p) => p.text === '?')).toMatchObject({ fill: DARK_COLOURS.ink });
    expect(drawn.find((p) => p.stroke !== undefined)).toMatchObject({ stroke: DARK_COLOURS.ink });
    expect(drawn.find((p) => p.text === 'Hover')).toMatchObject({ fill: DARK_COLOURS.ink });
  });

  it('draws a measure in the light ink', () => {
    const fields: MeasureFields = { kind: 'measure', x: 0, y: 0, width: 2.4, height: 0.01, rotation: 0, name: '' };
    const measure = measureItem('m', fields, 'metres');
    const lines = flat(measure.draw?.(context(DARK_COLOURS, measure.width, measure.height)))
      .filter((el) => el.type === 'Line')
      .map(propsOf);
    expect(lines.length).toBe(3);
    for (const line of lines) expect(line.stroke).toBe(DARK_COLOURS.ink);
  });

  it('puts the dark page behind a label as its halo, so the light ink stays legible; paper and prints keep the fixed paper', () => {
    expect(labelHalo(1, DARK_COLOURS).stroke).toBe(DARK_COLOURS.paper);
    expect(labelHalo(1, PAPER_COLOURS).stroke).toBe(PAPER);
    expect(labelHalo(1, { ink: INK, paper: '#FFFFFF', raised: RAISED }).stroke).toBe(PAPER);
    expect(labelHalo(1).stroke).toBe(PAPER);
    // Read from the palette itself (round 3): a copy of the Dark palette keeps its halo.
    expect(labelHalo(1, { ...DARK_COLOURS }).stroke).toBe(DARK_COLOURS.paper);
  });
});

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;

describe('a wall in the Dark view', () => {
  it('is filled with the light ink the plan builds it with, and with ink on paper', async () => {
    const sceneId = crypto.randomUUID();
    await store.getState().apply([{ kind: 'create', record: { id: sceneId, type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '4', name: 'Diner' } } }]);
    await store.getState().apply(startRoomChanges(records(), project.projectId, sceneId));
    const roomId = sceneRoomId(records(), records()[sceneId]) ?? '';
    const made = wallsAlong(records(), roomId, [
      { x: 0, y: 0 },
      { x: 3.5, y: 0 },
    ]);
    await store.getState().apply(made.changes);
    const fillOf = (ink: string, colours: CanvasColours) => {
      const wall = planCanvasItems(records(), sceneId, null, 'metres', ink).find((i) => i.id === made.ids[0]);
      return propsOf(wall?.draw?.(context(colours, wall.width, wall.height))).fill;
    };
    expect(fillOf(DARK_COLOURS.ink, DARK_COLOURS)).toBe(DARK_COLOURS.ink);
    expect(fillOf(INK, PAPER_COLOURS)).toBe(INK);
  });
});
