import type { ComponentType } from 'react';
import { InspectorTile } from '../../features/storyboard/InspectorTile';
import { ScenesTile } from '../../features/storyboard/ScenesTile';
import { StoryboardTile } from '../../features/storyboard/StoryboardTile';
import { HistoryTile } from '../../features/history/HistoryTile';
import { TrashTile } from '../../features/trash/TrashTile';
import { ColorScriptTile } from '../../features/storyboard/palette/ColorScriptTile';
import { PlayerTile } from '../../features/video/PlayerTile';
import { LocationsTile } from '../../features/locations/LocationsTile';
import { PeopleTile } from '../../features/people/PeopleTile';
import { TeamTile } from '../../features/people/TeamTile';
import { DepartmentTile } from '../../features/department/DepartmentTile';
import { DaysTile } from '../../features/schedule/DaysTile';
import { CalendarTile } from '../../features/schedule/CalendarTile';
import { GearTile } from '../../features/gear/GearTile';
import { NotificationsTile } from '../../features/notifications/NotificationsTile';
import { AssetsTile } from '../../features/assets/AssetsTile';
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
  locations: LocationsTile,
  people: PeopleTile,
  team: TeamTile,
  department: DepartmentTile,
  days: DaysTile,
  calendar: CalendarTile,
  gear: GearTile,
  notifications: NotificationsTile,
  assets: AssetsTile,
};
