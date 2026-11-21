import type { SbdRecord } from '../model/record';
import { allChecks, allChecksMade, CHECK_KINDS, type AllChecksResult, type AnyFinding, type CheckFinding, type CheckKind, type CheckSkip, type CheckTarget, type HeldForChecks } from './allChecks';
import { callSheetChecks, type CallSheetCheckResult, type CallSheetFinding, type SkippedCheck } from './callSheetChecks';
import { checkContext, type CheckContext } from './context';
import { departmentMissing, type DepartmentMissing } from './departmentMissing';
import { exteriorRain, RAIN_MM, type ExteriorRain, type HeldForecasts } from './exteriorRain';
import { gearNotOnDay, type GearNotOnDay } from './gearOnDay';
import { goldenHourMidday, type GoldenHourMidday } from './goldenHourMidday';
import { hmuTooShort, type HmuTooShort } from './hmuTooShort';
import { locationMissing, type LocationDetail, type LocationMissing } from './locationMissing';
import { planLensDiffers, type PlanLensDiffers } from './planLens';
import { unavailableOnDay, unavailableOnSheet, type UnavailableOnDay } from './unavailableOnDay';

// The consistency checks (CLAUDE.md "MCP server: Checks"), shared by the app and the MCP check tool (Phase 7). Each
// reads the records and returns findings; none is stored, and none changes anything. More joined as their phases
// brought what they read (6.4's lens check reads the bird's-eye plans; 7.3's, unavailable dates). The call sheet's (4.8)
// run for one day, by callSheetChecks, because what a sheet needs depends on who is on that day; 7.3's runs there too.

export type Finding = GearNotOnDay | PlanLensDiffers | UnavailableOnDay;

/** Every project-wide check's findings for a project. */
export function runChecks(records: Readonly<Record<string, SbdRecord>>, projectId: string): Finding[] {
  return [...gearNotOnDay(records, projectId), ...planLensDiffers(records, projectId), ...unavailableOnDay(records, projectId)];
}

export { gearNotOnDay, planLensDiffers, unavailableOnDay, type GearNotOnDay, type PlanLensDiffers, type UnavailableOnDay };
export { allChecks, allChecksMade, CHECK_KINDS, type AllChecksResult, type AnyFinding, type CheckFinding, type CheckKind, type CheckSkip, type CheckTarget, type HeldForChecks };
export {
  callSheetChecks,
  checkContext,
  departmentMissing,
  exteriorRain,
  goldenHourMidday,
  hmuTooShort,
  locationMissing,
  RAIN_MM,
  unavailableOnSheet,
  type CallSheetCheckResult,
  type CallSheetFinding,
  type CheckContext,
  type DepartmentMissing,
  type ExteriorRain,
  type GoldenHourMidday,
  type HeldForecasts,
  type HmuTooShort,
  type LocationDetail,
  type LocationMissing,
  type SkippedCheck,
};
