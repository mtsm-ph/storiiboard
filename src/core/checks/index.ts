import type { SbdRecord } from '../model/record';
import { gearNotOnDay, type GearNotOnDay } from './gearOnDay';

// The consistency checks (CLAUDE.md "MCP server: Checks"), shared by the app and the MCP check tool (Phase 7). Each
// reads the records and returns findings; none is stored, and none changes anything. More join as their phases
// bring what they read (availability, weather, call sheets, the bird's-eye plans).

export type Finding = GearNotOnDay;

/** Every check's findings for a project. */
export function runChecks(records: Readonly<Record<string, SbdRecord>>, projectId: string): Finding[] {
  return [...gearNotOnDay(records, projectId)];
}

export { gearNotOnDay, type GearNotOnDay };
