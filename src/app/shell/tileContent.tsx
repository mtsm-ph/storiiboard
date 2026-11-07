import type { ComponentType } from 'react';
import { InspectorTile } from '../../features/storyboard/InspectorTile';
import { ScenesTile } from '../../features/storyboard/ScenesTile';
import { StoryboardTile } from '../../features/storyboard/StoryboardTile';
import { HistoryTile } from '../../features/history/HistoryTile';
import { TrashTile } from '../../features/trash/TrashTile';
import { ColorScriptTile } from '../../features/storyboard/palette/ColorScriptTile';
import { PlayerTile } from '../../features/video/PlayerTile';
import type { TileId } from './docking/layout';

// Tiles whose tools are built. Every other tile shows its placeholder note (TILES in workspaces.ts) until its phase.
export const TILE_CONTENT: Partial<Record<TileId, ComponentType>> = {
  scenes: ScenesTile,
  board: StoryboardTile,
  inspector: InspectorTile,
  trash: TrashTile,
  history: HistoryTile,
  colorScript: ColorScriptTile,
  player: PlayerTile,
};
