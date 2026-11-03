import type { ComponentType } from 'react';
import { BackupsPanel } from '../project/BackupsPanel';
import { ScenesTile } from '../../features/storyboard/ScenesTile';
import { StoryboardTile } from '../../features/storyboard/StoryboardTile';
import { ProjectHome } from '../project/ProjectHome';
import type { TileId } from './docking/layout';

// Tiles whose tools are built. Every other tile shows its placeholder note (TILES in workspaces.ts) until its phase.
export const TILE_CONTENT: Partial<Record<TileId, ComponentType>> = {
  scenes: ScenesTile,
  board: StoryboardTile,
  project: ProjectHome,
  backups: BackupsPanel,
};
