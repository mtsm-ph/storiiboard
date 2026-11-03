import type { ComponentType } from 'react';
import { ProjectHome } from '../project/ProjectHome';
import type { TileId } from './docking/layout';

// Tiles whose tools are built. Every other tile shows its placeholder note (TILES in workspaces.ts) until its phase.
export const TILE_CONTENT: Partial<Record<TileId, ComponentType>> = {
  project: ProjectHome,
};
