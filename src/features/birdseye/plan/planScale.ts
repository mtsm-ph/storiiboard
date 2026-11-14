import { t } from '../../../core/i18n';
import { FEET_TO_METRES, formatLength, parseLength, roundLengthLabel, type PlanUnit } from '../../../core/model/length';
import type { CanvasScale, ToolSpec, ZoomLimits } from '../../../ui/canvas/types';

// Where the plan meets the canvas core (6.2a). The file holds metres; the canvas works in its own world units, and the
// plan makes 1 unit 1 cm, so the core's constants built for boards land at real sizes that make sense: the least size 8
// is 8 cm, a nudge 1 cm (Shift: 10 cm), a paste's offset 16 cm. Every conversion goes through these two functions,
// and canvas units are never stored.

/** Canvas units per metre. */
export const UNITS_PER_METRE = 100;

export const toCanvas = (metres: number): number => Math.round(metres * UNITS_PER_METRE * 100) / 100;
export const toMetres = (units: number): number => Math.round((units / UNITS_PER_METRE) * 10000) / 10000;

const FOOT = FEET_TO_METRES * UNITS_PER_METRE;

/**
 * The canvas's scale in the unit the screen shows: lengths read and written in it, a grid of 0.5 m (strong every 1 m) or
 * 1 ft (strong every 5 ft), Alt snapping to 5 cm or 1 inch, and round lengths for the rulers and the scale bar.
 */
export function planScale(unit: PlanUnit): CanvasScale {
  const metres = unit === 'metres';
  return {
    format: (units) => formatLength(toMetres(units), unit),
    parse: (text) => {
      const m = parseLength(text, unit);
      return m === null ? null : toCanvas(m);
    },
    label: (units) => roundLengthLabel(toMetres(units), unit),
    grid: metres ? { step: 50, major: 2, fine: 5 } : { step: FOOT, major: 5, fine: FOOT / 12 },
    rounds: metres ? [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : [1, 2, 5, 10, 20, 50, 100, 200, 500].map((ft) => ft * FOOT),
  };
}

/**
 * How far a plan zooms: out far enough for a 60 m stage in a small tile (2%: 60 m is 120 px), in close enough for a 2 m
 * prop table to fill the screen (2000%: 1 cm is 20 px); a fit zooms in to 400% at most.
 */
export const PLAN_ZOOM: ZoomLimits = { min: 0.02, max: 20, fitMax: 4 };

/** The Wall tool's id, a host tool of the canvas core. */
export const WALL_TOOL = 'host:wall';

/** The plan's tools (6.2a): Select, Hand and Wall; doors, windows and the library come in later milestones. */
export const PLAN_TOOLS: readonly ToolSpec[] = [
  { id: 'select', key: 'V', label: () => t('canvas.tool.select') },
  { id: 'hand', key: 'H', label: () => t('canvas.tool.hand') },
  // Drawn as thick as a wall is (10 cm), while it's drawn.
  { id: WALL_TOOL, key: 'W', label: () => t('plan.tool.wall'), pointToPoint: true, pathWidth: 10 },
];
