import { PLAN_LAYERS, type PlanLayer } from '../../../core/model/plan';

// The kit's 68 bird's-eye plan icons (see INDEX.md here): 32px grid, 1.5px ink stroke, department fill. Phase 6 (6.3)
// places them on plans from the Library tile, drawn exactly as these SVGs are, never recoloured, in light and dark
// (docs/PHASE6_DECISIONS.md 13); the catalogue shows them too.

/** The icons' groups, which are the plan's layers (src/core/model/plan.ts). */
export const PLAN_ICON_GROUPS = PLAN_LAYERS;

export type PlanIconGroup = PlanLayer;

export interface PlanIcon {
  /** "camera/dolly-track": the file path inside this folder, without .svg. */
  id: string;
  group: PlanIconGroup;
  /** From the SVG's <title>, e.g. "Dolly + track". */
  label: string;
  /** The SVG markup, ready for an <img> data URL or the canvas. */
  svg: string;
}

const sources = import.meta.glob<string>('./*/*.svg', { eager: true, query: '?raw', import: 'default' });

function isPlanIconGroup(value: string): value is PlanIconGroup {
  return (PLAN_ICON_GROUPS as readonly string[]).includes(value);
}

export const PLAN_ICONS: readonly PlanIcon[] = Object.entries(sources)
  .map(([path, svg]) => {
    const id = path.replace(/^\.\//, '').replace(/\.svg$/, '');
    const group = id.split('/')[0] ?? '';
    if (!isPlanIconGroup(group)) throw new Error(`Plan icon outside a department folder: ${path}`);
    const label = /<title>([^<]+)<\/title>/.exec(svg)?.[1] ?? id;
    return { id, group, label, svg };
  })
  .sort(
    (a, b) => PLAN_ICON_GROUPS.indexOf(a.group) - PLAN_ICON_GROUPS.indexOf(b.group) || a.id.localeCompare(b.id),
  );

export function planIconDataUrl(icon: PlanIcon): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(icon.svg)}`;
}
