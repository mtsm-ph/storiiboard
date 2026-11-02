import { useState } from 'react';
import { Tile } from '../../ui/Tile';
import { WORKSPACE_PANEL_ID, workspaceTabId, type Workspace } from './workspaces';

// Static layouts for now. Maximize works by clicking; docking, backtick, close and reflow arrive with D2.
export function TileArea({ workspace }: { workspace: Workspace }) {
  const [maximized, setMaximized] = useState<string | null>(null);
  const tiles = maximized === null ? workspace.tiles : workspace.tiles.filter((t) => t.area === maximized);

  return (
    <div
      id={WORKSPACE_PANEL_ID}
      role="tabpanel"
      aria-labelledby={workspaceTabId(workspace.id)}
      className="grid min-h-0 flex-1 gap-gap p-gap"
      style={
        maximized === null
          ? { gridTemplateColumns: workspace.columns, gridTemplateRows: workspace.rows, gridTemplateAreas: workspace.areas }
          : { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' }
      }
    >
      {tiles.map((tile) => (
        <Tile
          key={tile.area}
          index={tile.index}
          title={tile.title}
          maximized={maximized === tile.area}
          onToggleMaximize={() => {
            setMaximized((current) => (current === tile.area ? null : tile.area));
          }}
          style={maximized === null ? { gridArea: tile.area } : undefined}
        >
          <p className="sb-label p-3 text-muted">{tile.note}</p>
        </Tile>
      ))}
    </div>
  );
}
