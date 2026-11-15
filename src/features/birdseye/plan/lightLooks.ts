import { formatNumber, t } from '../../../core/i18n';
import type { PlanUnit } from '../../../core/model/length';
import type { ShownItem } from '../../../core/model/plan';
import { beamOf, lightWatts, liveLight } from '../../../core/model/planLight';
import type { SbdRecord } from '../../../core/model/record';
import { heightLabel } from './cameraLooks';
import type { LightLook } from './lightDraw';

// What each light on a plan shows past its box (6.5), worked out from the records each time they change: its beam's
// angle and its labels. Its watts may be its gear item's, read live, so a wattage changed in Gear changes the plan with
// no edit to it.

type Records = Readonly<Record<string, SbdRecord>>;

/** "650 W": a wattage as the plan and the legend write it. */
export const wattsLabel = (watts: number): string => t('plan.light.watts', { watts: formatNumber(watts) });

/** One light's look: its name, its watts when known, its height when set (as a camera's is said). */
export function lightLookOf(records: Records, lightId: string, unit: PlanUnit, selected: boolean): LightLook | null {
  const light = liveLight(records, lightId);
  if (!light) return null;
  const watts = lightWatts(records, lightId);
  const height = light.fields.heightM === null ? null : heightLabel({ from: 'camera', metres: light.fields.heightM }, unit);
  const lines = [light.fields.name, watts ? wattsLabel(watts.watts) : '', height ?? ''].filter((line) => line !== '');
  return { degrees: beamOf(light.fields), lines, selected };
}

/** Every shown light's look, by id. */
export function lightLooks(records: Records, shown: readonly ShownItem[], unit: PlanUnit, selection: readonly string[]): Map<string, LightLook> {
  const picked = new Set(selection);
  return new Map(
    shown.flatMap((item) => {
      if (item.fields.kind !== 'light') return [];
      const look = lightLookOf(records, item.record.id, unit, picked.has(item.record.id));
      return look ? [[item.record.id, look] as const] : [];
    }),
  );
}
