import { t } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { characterName } from '../../../core/model/person';
import { CAST_MARK_ICON, MARK_ICON, NEXT_POSITION_ICON, type MarkFields, type ShownItem } from '../../../core/model/plan';
import { markOwner, moveLength, viewBlocking, type MarkOwner, type Position } from '../../../core/model/planBlocking';
import { cameraCone, cameraShortTitle, liveCamera } from '../../../core/model/planCamera';
import type { SbdRecord } from '../../../core/model/record';
import { unionBounds } from '../../../ui/canvas/viewport';
import type { PathLook } from './markDraw';
import { toCanvas } from './planScale';

// What each mark on a plan shows (6.7), worked out from the records each time they change: the kit's drawing for what
// it is (a character's first position, a later one, a plain tape mark, or the camera's own icon dimmed for one of a
// camera's later positions), its upright label ("ANA 2", "A 3"), a ghost camera's cone edges, and each owner's path,
// kept on its first position. Read live (planBlocking.ts), never stored, so a renamed character, a moved position or a
// lens changed on the board changes the plan with no edit to it.

type Records = Readonly<Record<string, SbdRecord>>;

export interface MarkLook {
  /** The kit's icon it is drawn as. */
  icon: string;
  /** Drawn dimmed: a camera's later position. */
  ghost: boolean;
  /** Its labels, top to bottom. */
  lines: string[];
  /** A camera's later position's cone, degrees (its edges only); null for none. */
  cone: number | null;
  /** What it is called aloud. */
  say: string;
  selected: boolean;
  /**
   * The text drawn inside a character's mark in place of the kit's "A1" or "A2": the character's first letter and the
   * position's number ("B1", "A3"), so it never contradicts the label beneath. Absent for a camera's and a plain mark.
   */
  texts?: string;
}

/** "B" for BEN: the first letter of the name as shown, upper case; "?" when it has none. */
export function characterInitial(records: Records, id: string): string {
  const character = records[id];
  const first = Array.from((character ? characterName(character) : '').trim())[0];
  return first === undefined ? '?' : first.toUpperCase();
}

export interface BlockingLooks {
  marks: ReadonlyMap<string, MarkLook>;
  /** Each owner's path, by the id of its first position (a mark, or a camera's own item). */
  paths: ReadonlyMap<string, PathLook>;
  /** Each moving camera's move, metres, by its id. */
  moves: ReadonlyMap<string, number>;
}

/** A character's name as the app shows it, or "Character" when it has none. */
export function characterTitle(records: Records, id: string): string {
  const character = records[id];
  const name = character ? characterName(character) : '';
  return name === '' ? t('plan.mark.unnamedCharacter') : name;
}

/** "ANA", or a camera's letter ("A") when it has one, "Camera" otherwise; two that would read the same told apart (cameraShortTitle). */
export function ownerTitle(records: Records, owner: MarkOwner): string {
  return owner.kind === 'character' ? characterTitle(records, owner.id) : cameraShortTitle(records, owner.id);
}

/** "3.20 m move". */
export const moveLabel = (metres: number, unit: PlanUnit): string => t('plan.mark.move', { length: formatLength(metres, unit) });

const boxOf = (p: Position) => ({ x: toCanvas(p.fields.x), y: toCanvas(p.fields.y), width: toCanvas(p.fields.width), height: toCanvas(p.fields.height) });

/** A run of positions' path, canvas units: their middles, where each line stops, and their boxes together. */
export function pathOf(positions: readonly Position[]): PathLook | null {
  if (positions.length < 2) return null;
  const boxes = positions.map(boxOf);
  return {
    points: positions.map((p) => ({ x: toCanvas(p.centre.x), y: toCanvas(p.centre.y) })),
    radii: positions.map((p) => toCanvas(Math.min(p.fields.width, p.fields.height) / 2)),
    fit: unionBounds(boxes) ?? { x: 0, y: 0, width: 0, height: 0 },
  };
}

/** Every shown mark's look, each owner's path and each moving camera's length, for a view. */
export function blockingLooks(records: Records, view: { sceneId: string; setupId: string | null }, shown: readonly ShownItem[], unit: PlanUnit, selection: readonly string[]): BlockingLooks {
  const blocking = viewBlocking(records, view.sceneId, view.setupId);
  const picked = new Set(selection);
  const marks = new Map<string, MarkLook>();
  const paths = new Map<string, PathLook>();
  const moves = new Map<string, number>();
  for (const { positions } of [...blocking.characters, ...blocking.cameras]) {
    const path = pathOf(positions);
    const first = positions[0];
    if (path && first) paths.set(first.record.id, path);
  }
  for (const { owner, positions } of blocking.cameras) moves.set(owner.id, moveLength(positions));
  for (const item of shown) {
    if (item.fields.kind !== 'mark') continue;
    const fields: MarkFields = item.fields;
    const id = item.record.id;
    const of = blocking.numbers.get(id);
    const owner = of?.owner ?? markOwner(records, item.record);
    const named = fields.name !== '' ? [fields.name] : [];
    if (!owner || !of) {
      marks.set(id, { icon: MARK_ICON, ghost: false, lines: named, cone: null, say: fields.name === '' ? t('plan.mark.plainSay') : t('plan.mark.plainSayNamed', { name: fields.name }), selected: picked.has(id) });
      continue;
    }
    const who = ownerTitle(records, owner);
    const position = { number: String(of.number), count: String(of.count) };
    if (owner.kind === 'character') {
      marks.set(id, {
        icon: of.number === 1 ? CAST_MARK_ICON : NEXT_POSITION_ICON,
        ghost: false,
        lines: [...named, t('plan.mark.label', { name: who, number: String(of.number) })],
        cone: null,
        say: t('plan.mark.say', { name: who, ...position }),
        selected: picked.has(id),
        texts: `${characterInitial(records, owner.id)}${String(of.number)}`,
      });
      continue;
    }
    const camera = liveCamera(records, owner.id);
    const cone = cameraCone(records, owner.id);
    const last = of.number === of.count;
    const length = moves.get(owner.id) ?? 0;
    marks.set(id, {
      icon: camera?.fields.icon ?? MARK_ICON,
      ghost: true,
      lines: [...named, t('plan.mark.label', { name: who, number: String(of.number) }), ...(last ? [moveLabel(length, unit)] : [])],
      cone: cone && !('missing' in cone) ? cone.degrees : null,
      say: t('plan.mark.say', { name: who, ...position }),
      selected: picked.has(id),
    });
  }
  return { marks, paths, moves };
}
