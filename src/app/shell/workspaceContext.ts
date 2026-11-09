import { createContext, useContext } from 'react';
import type { WorkspaceId } from './workspaces';

// The workspace a tile is drawn in, for a tile whose view depends on it: the Department tile (3.6a) shows its
// workspace's department. Provided by the Dock around every tile.
export const WorkspaceContext = createContext<WorkspaceId>('storyboard');

export function useWorkspaceId(): WorkspaceId {
  return useContext(WorkspaceContext);
}
