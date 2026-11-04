import type { ComponentType } from 'react';
import { BackupsPanel } from '../project/BackupsPanel';
import { InspectorTile } from '../../features/storyboard/InspectorTile';
import { ScenesTile } from '../../features/storyboard/ScenesTile';
import { StoryboardTile } from '../../features/storyboard/StoryboardTile';
import { ProjectHome } from '../project/ProjectHome';
import { StorageTile } from '../project/StorageTile';
import { ThemeTile } from '../theme/ThemeTile';
import { HistoryTile } from '../../features/history/HistoryTile';
import { TrashTile } from '../../features/trash/TrashTile';
import type { TileId } from './docking/layout';

// Tiles whose tools are built. Every other tile shows its placeholder note (TILES in workspaces.ts) until its phase.
export const TILE_CONTENT: Partial<Record<TileId, ComponentType>> = {
  scenes: ScenesTile,
  board: StoryboardTile,
  inspector: InspectorTile,
  project: ProjectHome,
  backups: BackupsPanel,
  theme: ThemeTile,
  trash: TrashTile,
  storage: StorageTile,
  history: HistoryTile,
};
