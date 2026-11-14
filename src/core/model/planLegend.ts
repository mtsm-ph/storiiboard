import { isCamera, isLight, isOpening, isWallFields, PLAN_LAYERS, planItemLayer, shownItems, type PlanLayer } from './plan';
import { cameraHeight, cameraTitle } from './planCamera';
import { lightWatts } from './planLight';
import type { SbdRecord } from './record';

// A setup's legend (6.5, decisions 8 and 11), the one reading that the Selection tile shows and 6.10's export prints:
// what the setup's plan shows (the room's set pieces, the scene's blocking and the setup's own; never its walls, doors
// or windows), by department in the plan's layer order, each line an item's name (else what it is), how many when the
// same thing repeats, its height when set and, for lights, their watts; and the setup's total watts, a light with no
// wattage counted as unknown. Worked out from the records each time, never stored.

type Records = Readonly<Record<string, SbdRecord>>;

/** A height as a line reads it: metres, or a linked frame's choice for a camera ("eye", 3.18), read live. */
export type LegendHeight = { metres: number } | { frame: string };

export interface LegendLine {
  /** Its name, else what it is ("Fresnel"), else a camera's title ("A · Sticks"). */
  label: string;
  count: number;
  height: LegendHeight | null;
  /** A light's watts, each; null when it has none (unknown). Absent for anything else. */
  watts?: number | null;
}

export interface LegendGroup {
  layer: PlanLayer;
  lines: LegendLine[];
}

export interface PlanLegend {
  groups: LegendGroup[];
  /** The setup's lights: their known watts added up, and how many have none. */
  watts: { lights: number; known: number; unknown: number };
}

const heightKey = (h: LegendHeight | null): string => (h === null ? '' : 'metres' in h ? `m:${String(h.metres)}` : `f:${h.frame}`);

/**
 * The legend of a setup's plan (or a scene's, with no setup): `iconName` says what an icon is in the app's language
 * (iconLabel), as cameraTitle takes it.
 */
export function planLegend(records: Records, sceneId: string, setupId: string | null, iconName: (icon: string) => string): PlanLegend {
  const lines = new Map<PlanLayer, Map<string, LegendLine>>();
  const watts = { lights: 0, known: 0, unknown: 0 };
  for (const { record, fields } of shownItems(records, sceneId, setupId)) {
    if (isWallFields(fields) || isOpening(fields)) continue;
    const layer = planItemLayer(record.props);
    if (layer === null) continue;
    let label: string;
    let height: LegendHeight | null;
    if (isCamera(fields)) {
      label = cameraTitle(records, record.id, iconName);
      const h = cameraHeight(records, record.id);
      height = h === null ? null : h.from === 'frame' ? { frame: h.value } : { metres: h.metres };
    } else {
      label = fields.name !== '' ? fields.name : iconName(fields.icon);
      height = fields.heightM === null ? null : { metres: fields.heightM };
    }
    let each: number | null | undefined;
    if (isLight(fields)) {
      each = lightWatts(records, record.id)?.watts ?? null;
      watts.lights += 1;
      if (each === null) watts.unknown += 1;
      else watts.known += each;
    }
    const key = `${label}\u0000${heightKey(height)}\u0000${each === undefined ? '-' : String(each)}`;
    const group = lines.get(layer) ?? new Map<string, LegendLine>();
    lines.set(layer, group);
    const had = group.get(key);
    if (had) had.count += 1;
    else group.set(key, { label, count: 1, height, ...(each === undefined ? {} : { watts: each }) });
  }
  const groups = PLAN_LAYERS.flatMap((layer): LegendGroup[] => {
    const group = lines.get(layer);
    return group ? [{ layer, lines: [...group.values()] }] : [];
  });
  return { groups, watts: { ...watts, known: Math.round(watts.known * 10) / 10 } };
}
