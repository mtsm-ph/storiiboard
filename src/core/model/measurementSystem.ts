import type { PlanUnitsChoice, WeatherUnitsChoice } from '../storage/settings';

// The Measurement system (Kevin, Nov 18): By this computer's region, Metric or US, one choice that sets a plan's
// lengths (m or ft) and the forecast's units, which also give the nearest hospital's distances (km or mi), together.
// It is never stored: the two settings beneath it stay the ones kept, so a computer upgraded shows what it showed before,
// and Measurement system is read from them, "Mixed" when they don't agree. No rule makes one follow the other.

export type MeasurementSystem = 'region' | 'metric' | 'us';

/** What Settings reads: a system when the two settings agree, else Mixed. */
export type MeasurementReading = MeasurementSystem | 'mixed';

export const isMeasurementSystem = (value: unknown): value is MeasurementSystem => value === 'region' || value === 'metric' || value === 'us';

/** The two settings a system sets. */
export function unitsOfSystem(system: MeasurementSystem): { weatherUnits: WeatherUnitsChoice; planUnits: PlanUnitsChoice } {
  if (system === 'metric') return { weatherUnits: 'metric', planUnits: 'metres' };
  if (system === 'us') return { weatherUnits: 'us', planUnits: 'feet' };
  return { weatherUnits: 'region', planUnits: 'region' };
}

/**
 * The system the two settings make, by the choices themselves: By region with By region, Metric with Metres, US with
 * Feet. Anything else is Mixed, even where it shows the same on this computer (Metric weather and plans by a metric
 * region): it reads as what was chosen, never as what it happens to resolve to here.
 */
export function measurementOf(weatherUnits: WeatherUnitsChoice, planUnits: PlanUnitsChoice): MeasurementReading {
  for (const system of ['region', 'metric', 'us'] as const) {
    const units = unitsOfSystem(system);
    if (units.weatherUnits === weatherUnits && units.planUnits === planUnits) return system;
  }
  return 'mixed';
}
