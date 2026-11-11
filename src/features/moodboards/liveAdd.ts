import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { TIDY_GAP } from '../../ui/canvas/arrange';
import { tidy } from '../../ui/canvas/placement';
import type { Point } from '../../ui/canvas/types';
import { createItems, type ItemSeed } from './items';
import { designSize } from './liveCards';

// Cards put on a board from the storyboard (5.4): "Add from storyboard" and the storyboard's "Add to board…". Each names its
// record and nothing else; they land together as a tidied row (5.3's row: 24 units apart, tops level) centred on a point,
// all in one op group.

type Records = Readonly<Record<string, SbdRecord>>;

/** A card to make: its kind, and the frame or scene it shows (the brand kit shows the project's company, so it has none). */
export type CardTarget = { kind: 'shot_card'; shotId: string } | { kind: 'scene_card' | 'palette_card'; sceneId: string } | { kind: 'brand_card' };

/** The record a target names, for the live check. */
const idOf = (target: CardTarget): string => (target.kind === 'shot_card' ? target.shotId : target.kind === 'brand_card' ? '' : target.sceneId);

/** The cards for these targets as one row centred on `centre`; a frame or scene that isn't live is left out. */
export function cardChanges(records: Records, boardId: string, targets: readonly CardTarget[], centre: Point): { ids: string[]; changes: Change[] } {
  const live = targets.filter((target) => target.kind === 'brand_card' || (records[idOf(target)]?.trashedAt === null && records[idOf(target)] !== undefined));
  const sized = live.map((target) => {
    // One size per kind, whatever the card shows now or later.
    return { target, size: designSize(target.kind) };
  });
  const total = sized.reduce((sum, { size }, i) => sum + size.width + (i > 0 ? TIDY_GAP : 0), 0);
  const tallest = Math.max(0, ...sized.map(({ size }) => size.height));
  let x = centre.x - total / 2;
  const top = centre.y - tallest / 2;
  const seeds = sized.map(({ target, size }): ItemSeed => {
    const seed: ItemSeed = {
      kind: target.kind,
      x: tidy(x),
      y: tidy(top),
      width: size.width,
      height: size.height,
      rotation: 0,
      ...(target.kind === 'shot_card' ? { shotId: target.shotId } : {}),
      ...(target.kind === 'scene_card' || target.kind === 'palette_card' ? { sceneId: target.sceneId } : {}),
    };
    x += size.width + TIDY_GAP;
    return seed;
  });
  return createItems(records, boardId, seeds);
}
