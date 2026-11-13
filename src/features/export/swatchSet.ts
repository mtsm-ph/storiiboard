import { t } from '../../core/i18n';
import { cleanBrandColors, projectCompany } from '../../core/model/company';
import { paletteOf } from '../../core/model/palette';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';
import { headingOf } from '../storyboard/ScenesView';
import { exportName } from './names';

// What a swatches export is for (5.6b): one scene's palette, or the brand kit of the project's company. The swatches formats are
// scoped to it, as a deck's formats are to the deck, and are offered from the palette editor, a palette card and a brand card.

export type SwatchSource = { kind: 'scene'; sceneId: string } | { kind: 'brand' };

export interface SwatchSet {
  /** What names the file: "SC 04", or the company's name. */
  name: string;
  /** What the strip prints above the swatches and the .ase's group is called: the scene's heading, or the company's name. */
  heading: string;
  /** The heading in two parts for the strip: the scene's number in the mono face, then the rest; the company has only the rest. */
  parts: { label: string; title: string };
  /** `#RRGGBB`, in order. */
  hexes: string[];
}

/** The colours for a source as the project has them now, or null when the scene or company isn't there. */
export function swatchSet(records: Readonly<Record<string, SbdRecord>>, projectId: string, source: SwatchSource): SwatchSet | null {
  if (source.kind === 'scene') {
    const scene = records[source.sceneId];
    if (scene?.type !== 'scene' || scene.trashedAt !== null) return null;
    const fields = sceneFields(scene.props);
    const label = sceneLabel(fields.number);
    return { name: label, heading: `${label} ${headingOf(fields)}`.trim(), parts: { label, title: headingOf(fields) }, hexes: paletteOf(scene.props)?.colors.map((c) => c.hex) ?? [] };
  }
  const company = projectCompany(records[projectId]?.props);
  if (!company) return null;
  const name = company.name.trim() !== '' ? company.name : t('company.unnamed');
  return { name, heading: name, parts: { label: '', title: name }, hexes: cleanBrandColors(company.brandColors) };
}

/** "SC 04 palette.png", in Spanish "paleta de SC 04.png": the order of the parts is the language's (names.ts). */
export const swatchFileName = (name: string, extension: 'png' | 'ase'): string => exportName(name, null, t('export.swatches.what'), extension);
