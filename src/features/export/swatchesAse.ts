import { t, tn } from '../../core/i18n';
import { aseBytes } from '../../core/model/swatchesAse';
import type { ExportFormat, ExportResult } from './registry';
import { swatchFileName, swatchSet } from './swatchSet';

// Swatches as an Adobe Swatch Exchange file (5.6b): Photoshop, Illustrator and InDesign read it. The writer is
// src/core/model/swatchesAse.ts.

export const swatchesAse: ExportFormat = {
  id: 'swatches-ase',
  get label() {
    return t('export.swatches.ase.label');
  },
  get description() {
    return t('export.swatches.ase.description');
  },
  output: 'file',
  swatches: true,
  name: (title) => swatchFileName(title, 'ase'),
  run: async ({ records, projectId, swatches, target, signal }): Promise<ExportResult> => {
    const set = swatches ? swatchSet(records, projectId, swatches) : null;
    if (!set || set.hexes.length === 0) throw new Error(t('export.swatches.none'));
    signal.throwIfAborted();
    await target.write(swatchFileName(set.name, 'ase'), aseBytes(set.heading, set.hexes));
    return { what: tn('count.colors', set.hexes.length) };
  },
};
