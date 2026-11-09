import { approvalOf, isObject, type Approval, type Approver, type JsonObject } from '../../model/departmentStatus';
import type { JsonValue, SbdRecord } from '../../model/record';
import { approvalBasis } from '../../model/sceneApprovals';
import { loadRecords, loggedRewrite } from '../../ops/ops';
import type { ProjectFile, Statement } from '../driver';
import type { Migration } from '../migrate';

// Schema v9 (3.6b, approved by Kevin Nov 9): approvals move from frames to scenes. The director or the DP approves each
// department once per scene (src/core/model/sceneApprovals.ts); Seen, Working on it and Done stay per frame.
//
// This changes existing data, as Kevin approved: a scene is approved for a department, by an approver (the director,
// the DP), only if every frame in it was approved for that department by that approver. Otherwise it isn't, and
// that department is approved again once, on the scene. The scene's approval keeps the name and time of the latest of
// those frame approvals, and a fingerprint of the scene as it is now, so it starts current. Then every frame's
// approvals come off, approved or not, in the Trash or not; everything else in its department status stays.
//
// The frames of a scene: those in it now (a scene in the Trash: those that went with it). A scene without frames has
// no approvals to carry. migrate() copies the file to a backup before this runs, as before every migration.
//
// The changes are logged as one step in History (loggedRewrite), so it shows which approvals moved and which came off,
// and Restore to here reads the records as they now are. The undo and redo stacks end there: ⌘Z after the upgrade
// would otherwise write an older step's whole record back, a scene without its approvals or a frame with its own.

const APPROVERS: readonly Approver[] = ['director', 'dp'];

/** A frame's approvals, by department. */
function frameApprovals(shot: SbdRecord): Map<string, Approval[]> {
  const out = new Map<string, Approval[]>();
  const status = shot.props.department_status;
  if (!isObject(status)) return out;
  for (const [department, entry] of Object.entries(status)) {
    if (!isObject(entry) || !Array.isArray(entry.approvals)) continue;
    out.set(department, entry.approvals.map(approvalOf).filter((a): a is Approval => a !== null));
  }
  return out;
}

/**
 * A scene's approvals from its frames': for each department and approver, the latest of that approver's frame
 * approvals when every frame has one. One person who was both signs as one approval with both roles, as the app does.
 */
export function carriedApprovals(shots: readonly SbdRecord[]): Map<string, Approval[]> {
  const out = new Map<string, Approval[]>();
  if (shots.length === 0) return out;
  const perShot = shots.map(frameApprovals);
  const departments = new Set(perShot.flatMap((approvals) => [...approvals.keys()]));
  for (const department of departments) {
    const carried: Approval[] = [];
    for (const role of APPROVERS) {
      const each = perShot.map((approvals) =>
        (approvals.get(department) ?? []).filter((a) => a.roles.includes(role)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0],
      );
      if (each.some((a) => a === undefined)) continue;
      const latest = (each as Approval[]).reduce((a, b) => (b.at > a.at ? b : a));
      // The director's and the DP's, by one person who was both on every frame: one approval, as they gave it.
      const same = carried.find((c) => c.name === latest.name && c.at === latest.at && latest.roles.includes(c.roles[0] ?? role));
      if (same) same.roles.push(role);
      else carried.push({ name: latest.name, roles: [role], at: latest.at });
    }
    if (carried.length > 0) out.set(department, carried);
  }
  return out;
}

/**
 * A frame's department status with its approvals off; a department left with nothing set comes off too. An approval
 * this version can't read (no director or DP among its roles) stays as it was: it was never one of these.
 */
function withoutApprovals(status: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [department, entry] of Object.entries(status)) {
    if (!isObject(entry)) {
      out[department] = entry;
      continue;
    }
    const rest = Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'approvals'));
    const unread = Array.isArray(entry.approvals) ? entry.approvals.filter((a) => approvalOf(a) === null) : [];
    if (unread.length > 0) rest.approvals = unread;
    if (Object.keys(rest).length > 0) out[department] = rest;
  }
  return out;
}

async function backfill(file: ProjectFile, now: () => Date): Promise<Statement[]> {
  const list = await loadRecords(file);
  const records = Object.fromEntries(list.map((r) => [r.id, r]));
  const changes: { before: SbdRecord; props: JsonObject }[] = [];

  for (const scene of list) {
    if (scene.type !== 'scene') continue;
    // As approvalBasis counts them: live, or gone to the Trash with the scene.
    const shots = list.filter((r) => r.type === 'shot' && r.parentId === scene.id && (r.trashedAt === null || r.trashedAt === scene.trashedAt));
    const carried = carriedApprovals(shots);
    if (carried.size === 0) continue;
    const approvals: JsonObject = isObject(scene.props.department_approvals) ? { ...scene.props.department_approvals } : {};
    for (const [department, given] of carried) {
      // The fingerprint reads frames and ticks, never approvals, so it's the same before the frames' come off.
      const basis = approvalBasis(records, scene.id, department);
      approvals[department] = given.map((a): JsonValue => ({ name: a.name, roles: [...a.roles], at: a.at, basis }));
    }
    changes.push({ before: scene, props: { ...scene.props, department_approvals: approvals } });
  }

  for (const shot of list) {
    const status = shot.props.department_status;
    if (shot.type !== 'shot' || !isObject(status)) continue;
    const next = withoutApprovals(status);
    if (JSON.stringify(next) === JSON.stringify(status)) continue;
    changes.push({ before: shot, props: { ...shot.props, department_status: next } });
  }
  return loggedRewrite(file, changes, now().toISOString());
}

export const sceneApprovals: Migration = {
  version: 9,
  description: 'Approvals per scene: department_approvals on scenes, approvals off frames',
  statements: [],
  backfill,
};
