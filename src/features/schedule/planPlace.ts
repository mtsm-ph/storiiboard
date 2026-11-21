import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { sceneSetups, setupLabel } from '../../core/model/setup';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';

// A plan finding's place in words (6.5), on its own so the Checks tile's words (src/features/checks/checkWords.ts) read
// without the Shoot days tile, and 7.6's MCP server, which shares those words, bundles no screen. DaysTile re-exports it.

/** Where a plan's finding comes from (6.5): the setup's scene and its number now ("SC 01", "Setup 2"). */
export function planPlace(records: Readonly<Record<string, SbdRecord>>, setupId: string): { scene: string; setup: string } | null {
  const setup = records[setupId];
  const scene = setup?.parentId ? records[setup.parentId] : undefined;
  if (scene?.type !== 'scene') return null;
  // Named as setups are everywhere else (setupLabel: its number, and its name when it has one).
  const live = sceneSetups(records, scene.id).find((s) => s.record.id === setupId);
  return { scene: sceneLabel(sceneFields(scene.props).number), setup: live ? setupLabel(live) : t('history.aSetup') };
}
