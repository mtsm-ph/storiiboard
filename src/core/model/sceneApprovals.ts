import { t } from '../i18n';
import { approvalOf, approvalWho, departmentStatuses, isObject, type Approval, type Approver, type JsonObject } from './departmentStatus';
import { isDepartment } from './department';
import type { JsonValue, Props, SbdRecord } from './record';

// Approvals per scene (3.6b, Kevin Nov 9). The director or the DP approves each department once for a whole scene;
// Seen, Working on it and Done stay per frame. Before schema 9 a frame kept its own approvals; migration 9 moved them
// here (src/core/storage/migrations/009_scene_approvals.ts).
//
// Stored in the scene's `department_approvals` prop, by department id, each a list of sign-offs:
//   { "camera": [{ "name": "Kevin Matos", "roles": ["dp"], "at": "…", "basis": "3f9c…" }] }
// `basis` is a fingerprint of what the department touched in the scene when it was approved (approvalBasis). When the
// scene no longer matches it, the approval shows "Changed since approval" until it's given again. A fingerprint, not a
// time, so undoing the change brings the approval back to current, as undo should.
//
// What a department touches (3.15, Kevin Nov 9): the shared fields count for every department, the department's own
// notes and ticks only for it. A fingerprint from then on starts `2:`. 3.18 (Kevin Nov 9) adds the scene's characters
// for every department, and T-stop, support and height for camera and grip-electric: `3:`. One from before (3.6b's,
// with no prefix, which counted every frame field for every department; or 3.15's) is still read by the rule it was
// made with, so no approval turns "Changed" just because the rule did; given again, it takes the newest.
//
// Nor because the file's format did (Kevin Nov 9): a migration that rewrites what a rule reads (schema 12 turned a
// scene's character names into ids, which 3.6b's rule read) re-stamps every approval that was current just before it
// with its own rule's fingerprint of the records after it (approvalsKeptThrough).

type Records = Readonly<Record<string, SbdRecord>>;

export interface SceneApproval extends Approval {
  /** approvalBasis when it was given; '' when it's missing, which reads as changed. */
  basis: string;
}

/** By department id; ids this version doesn't know are read too, and every entry is written back as it was. */
export type SceneApprovals = Readonly<Record<string, readonly SceneApproval[]>>;

const stored = (props: Props): JsonObject => (isObject(props.department_approvals) ? props.department_approvals : {});

function sceneApprovalOf(value: JsonValue): SceneApproval | null {
  const approval = approvalOf(value);
  if (!approval || !isObject(value)) return null;
  return { ...approval, basis: typeof value.basis === 'string' ? value.basis : '' };
}

/** A scene's approvals, by department; departments without any left out. */
export function sceneApprovals(props: Props): SceneApprovals {
  const out: Record<string, SceneApproval[]> = {};
  for (const [department, list] of Object.entries(stored(props))) {
    if (!Array.isArray(list)) continue;
    const approvals = list.map(sceneApprovalOf).filter((a): a is SceneApproval => a !== null);
    if (approvals.length > 0) out[department] = approvals;
  }
  return out;
}

export const approvalsIn = (approvals: SceneApprovals, department: string): readonly SceneApproval[] => approvals[department] ?? [];

/** None given; all still match the scene; or at least one was given before the scene changed. */
export type SceneApprovalState = 'none' | 'approved' | 'changed';

/**
 * What a department touches now, by each rule an approval may have been given under: 3.18's (`current`, what a new
 * approval keeps), 3.15's (`v2`) and 3.6b's (`legacy`). 3.6b's is worked out only when an approval made by it is
 * read, since it reads the whole scene again; 3.15's costs one more hash of what 3.18's reads anyway.
 */
export interface ApprovalBasis {
  readonly current: string;
  readonly v2: string;
  readonly legacy: string;
}

/** A fingerprint made by 3.18's rule, and one made by 3.15's. */
const CURRENT = '3:';
const V2 = '2:';

/** A plain fingerprint reads as every rule's: for tests and callers that hold one already. */
const asBasis = (basis: ApprovalBasis | string): ApprovalBasis => (typeof basis === 'string' ? { current: basis, v2: basis, legacy: basis } : basis);

/**
 * The scene's fingerprint by the rule `stamp` was made with, or null for a rule this version doesn't know (a newer
 * version's, `4:` say), which reads as changed: approving again writes this version's.
 */
function byRuleOf(stamp: string, now: ApprovalBasis): string | null {
  if (stamp.startsWith(CURRENT)) return now.current;
  if (stamp.startsWith(V2)) return now.v2;
  // 3.6b's had no prefix: a hash, never a colon.
  return stamp.includes(':') ? null : now.legacy;
}

/** Whether an approval still matches the scene: by the rule it was given under. */
export function isCurrent(approval: SceneApproval, basis: ApprovalBasis | string): boolean {
  if (approval.basis === '') return false;
  return approval.basis === byRuleOf(approval.basis, asBasis(basis));
}

export function approvalState(approvals: readonly SceneApproval[], basis: ApprovalBasis | string): SceneApprovalState {
  if (approvals.length === 0) return 'none';
  return approvals.every((a) => isCurrent(a, basis)) ? 'approved' : 'changed';
}

const ours = (approval: Approval, roles: readonly Approver[]) => approval.roles.some((role) => roles.includes(role));

/** This person's own sign-off on a department, current or not. */
export const myApproval = (approvals: readonly SceneApproval[], roles: readonly Approver[]): SceneApproval | undefined =>
  approvals.find((a) => ours(a, roles));

/**
 * The scene's `department_approvals` after this person's Approved tick on a department, or null when it ends up
 * empty. Each sign-off is its approver's: a current one of theirs is taken back; one given before the scene changed
 * is given again, now; with none, theirs is added beside any other (the director's beside the DP's). Everything else
 * in the prop (other departments, sign-offs this version can't read) is written back as it was.
 */
export function withMySceneApproval(props: Props, department: string, mine: Approval, given: ApprovalBasis | string): JsonObject | null {
  const basis = asBasis(given);
  const all = stored(props);
  const list = Array.isArray(all[department]) ? all[department] : [];
  const isMine = (value: JsonValue) => {
    const approval = approvalOf(value);
    return approval !== null && ours(approval, mine.roles);
  };
  const current = list.map(sceneApprovalOf).find((a) => a !== null && ours(a, mine.roles) && isCurrent(a, basis));
  const kept = list.filter((value) => !isMine(value));
  const next: JsonValue[] = current ? kept : [...kept, { name: mine.name, roles: [...mine.roles], at: mine.at, basis: basis.current }];
  const out: JsonObject = Object.fromEntries(Object.entries(all).filter(([id]) => id !== department));
  if (next.length > 0) out[department] = next;
  return Object.keys(out).length > 0 ? out : null;
}

/** One department's approvals in words, as History lists them: "approved by Kevin Matos (DP)", or —. */
export function sceneApprovalText(value: JsonValue | undefined): string {
  if (!Array.isArray(value)) return '—';
  const approvals = value.map(approvalOf).filter((a): a is Approval => a !== null);
  return approvals.map((a) => t('departmentStatus.approvedByWho', { who: approvalWho(a) })).join(', ') || '—';
}

/** "approved by Kevin Matos (DP)", or "approved by Kevin Matos (DP) before a change", for the CSV. */
export function sceneApprovalLine(approvals: readonly SceneApproval[], basis: ApprovalBasis | string): string {
  return approvals
    .map((a) => t(isCurrent(a, basis) ? 'departmentStatus.approvedByWho' : 'sceneApproval.approvedBefore', { who: approvalWho(a) }))
    .join(', ');
}

// 3.6b's rule, kept to read the approvals given under it (`legacy`): the scene's own fields (heading, location,
// characters, length, palette); its frames and note cards in board order, each frame with its fields, its picture and
// its sketch; and that department's own Working on it and Done on each frame. Left out: the approvals themselves,
// Priority, Seen and every other department's ticks.
//
// 3.15's rule (`current`, Kevin Nov 9): not every field touches every department. Shared, for every department: each
// frame's picture (the stored file, how it sits in the frame, and the video clip it plays: in, out and framing) and
// sketch, its action, dialogue, shot size, lens and movement, and where it's shot (its own location); which frames
// the scene has, in order; and the scene's heading (its name, INT/EXT, DAY/NIGHT, location), as the frames' shared
// ground. The department's own, for it alone: its entry on each frame, its notes and ticks (Working on it, Done, and
// anything a newer version keeps there), never Priority. Nothing else (T-stop, support, height, a title, custom
// fields, gear, the shoot day, note cards, the scene's characters) changes an approval by this rule.
//
// 3.18's rule (`current`, Kevin Nov 9): 3.15's, plus the scene's characters (`character_ids`, and any value a name
// match left in `characters`) for every department, and each frame's T-stop, support and height for camera and
// grip-electric, who light and rig for them. Nothing else (a title, custom fields, gear, the shoot day, note cards)
// changes an approval. (When Phase 6 gives a frame its lens from a setup or the bird's-eye plan, that source belongs
// here too, as a rule of its own.)

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** JSON with every object's keys sorted, so the same content always reads the same. */
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** cyrb53: a fast 53-bit string hash, plenty to tell one scene's content from the next. Not for security. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const without = (props: Props, key: string): Props => Object.fromEntries(Object.entries(props).filter(([k]) => k !== key));

interface SceneContent {
  /** Everything but the departments' own parts: canonical JSON for 3.6b's rule, its hash for 3.15's. */
  shared: string;
  /** The scene's frames, in board order, for each department's ticks. */
  shots: readonly SbdRecord[];
}

/** Records' children by parent, in sibling order, worked out once per set of records. */
const childrenCache = new WeakMap<Records, Map<string, SbdRecord[]>>();
function childrenByParent(records: Records): Map<string, SbdRecord[]> {
  let byParent = childrenCache.get(records);
  if (!byParent) {
    byParent = new Map();
    for (const record of Object.values(records)) {
      if (record.parentId === null) continue;
      const list = byParent.get(record.parentId) ?? [];
      list.push(record);
      byParent.set(record.parentId, list);
    }
    for (const list of byParent.values()) list.sort(bySortKey);
    childrenCache.set(records, byParent);
  }
  return byParent;
}

const contentCache = new WeakMap<Records, Map<string, SceneContent>>();
function sceneContent(records: Records, sceneId: string): SceneContent | null {
  const scene = records[sceneId];
  if (scene?.type !== 'scene') return null;
  let byScene = contentCache.get(records);
  if (!byScene) {
    byScene = new Map<string, SceneContent>();
    contentCache.set(records, byScene);
  }
  const cached = byScene.get(sceneId);
  if (cached) return cached;
  // What's in an item: its live children, and for one in the Trash those that went with it too (a deleted scene takes
  // its frames along in the same step), so a scene restored reads as it did. One deleted on its own is left out.
  const byParent = childrenByParent(records);
  const inside = (parent: SbdRecord) =>
    (byParent.get(parent.id) ?? []).filter((child) => child.trashedAt === null || child.trashedAt === parent.trashedAt);
  // A frame's own items: its picture by content, the stored file's sha256 (a moved or relinked original is the same
  // picture), its sketch by stroke.
  const own = (shot: SbdRecord): JsonValue[] =>
    inside(shot).flatMap((child): JsonValue[] =>
      // Its picture, not a PDF or a link attached to it (3.11): attaching a release changes nothing a department did.
      child.type === 'media' && child.props.kind !== 'pdf' && child.props.kind !== 'link'
        ? [{ media: child.id, file: child.props.file ?? null }]
        : child.type === 'stroke'
          ? [{ stroke: child.id }]
          : [],
    );
  // Frames and note cards, as the board shows them.
  const items = inside(scene).filter((r) => r.type === 'shot' || r.type === 'note');
  const shared = canonical({
    scene: without(scene.props, 'department_approvals'),
    items: items.map((item): JsonValue =>
      item.type === 'note' ? { note: item.id, text: item.props.text ?? null } : { shot: item.id, props: without(item.props, 'department_status'), own: own(item) },
    ),
  });
  const content = { shared, shots: items.filter((r) => r.type === 'shot') };
  byScene.set(sceneId, content);
  return content;
}

/** 3.6b's fingerprint of what `department` touches in the scene now; '' for a scene that isn't there. */
function legacyBasis(records: Records, sceneId: string, department: string): string {
  const content = sceneContent(records, sceneId);
  if (!content) return '';
  const ticks = content.shots.map((shot) => {
    const status = departmentStatuses(shot.props)[department];
    return [status?.working === true, status?.done === true];
  });
  return hash(`${content.shared}|${department}|${canonical(ticks)}`);
}

/** A frame's fields every department works from (3.15). */
const SHARED_FRAME_FIELDS = ['action', 'dialogue', 'size', 'lens_mm', 'move', 'crop', 'clip', 'location_id'] as const;
/** The scene's heading: where and when its frames are. */
const SHARED_SCENE_FIELDS = ['name', 'heading', 'int_ext', 'day_night', 'location_id'] as const;
/** In a department's own entry on a frame: what isn't its notes or ticks. */
const NOT_OWN = new Set(['priority', 'approvals']);

const pick = (props: Props, keys: readonly string[]): JsonObject =>
  Object.fromEntries(keys.flatMap((key) => (props[key] === undefined ? [] : [[key, props[key]]])));

const sharedCache = new WeakMap<Records, Map<string, SceneContent>>();
/** 3.15's shared part of a scene: the same for every department. */
function sharedContent(records: Records, sceneId: string): SceneContent | null {
  const scene = records[sceneId];
  if (scene?.type !== 'scene') return null;
  let byScene = sharedCache.get(records);
  if (!byScene) {
    byScene = new Map<string, SceneContent>();
    sharedCache.set(records, byScene);
  }
  const cached = byScene.get(sceneId);
  if (cached) return cached;
  // As 3.6b reads them: live children, and for one in the Trash those that went with it.
  const byParent = childrenByParent(records);
  const inside = (parent: SbdRecord) =>
    (byParent.get(parent.id) ?? []).filter((child) => child.trashedAt === null || child.trashedAt === parent.trashedAt);
  const own = (shot: SbdRecord): JsonValue[] =>
    inside(shot).flatMap((child): JsonValue[] =>
      child.type === 'media' && child.props.kind !== 'pdf' && child.props.kind !== 'link'
        ? [{ media: child.id, file: child.props.file ?? null }]
        : child.type === 'stroke'
          ? [{ stroke: child.id }]
          : [],
    );
  const shots = inside(scene).filter((r) => r.type === 'shot');
  const shared = canonical({
    scene: pick(scene.props, SHARED_SCENE_FIELDS),
    frames: shots.map((shot): JsonValue => ({ shot: shot.id, props: pick(shot.props, SHARED_FRAME_FIELDS), own: own(shot) })),
  });
  // Hashed once for the scene: each department's fingerprint folds in its own part, so a board of many departments
  // never hashes the whole scene again for each.
  const content = { shared: hash(shared), shots };
  byScene.set(sceneId, content);
  return content;
}

/** The scene's cast, for every department (3.18). */
const CAST_SCENE_FIELDS = ['character_ids', 'characters'] as const;
/** What a frame is lit and rigged for (3.18), and the departments it counts for. */
const RIG_FRAME_FIELDS = ['t_stop', 'support', 'height'] as const;
const RIG_DEPARTMENTS: ReadonlySet<string> = new Set(['camera', 'grip-electric']);

const rigCache = new WeakMap<Records, Map<string, string>>();
/** 3.18's scene-wide parts: the cast, and the frames' rig for the departments it counts for. Hashed once a scene. */
function sceneExtras(records: Records, sceneId: string, content: SceneContent): { cast: string; rig: string } {
  let byScene = rigCache.get(records);
  if (!byScene) {
    byScene = new Map();
    rigCache.set(records, byScene);
  }
  const scene = records[sceneId];
  const cast = canonical(scene ? pick(scene.props, CAST_SCENE_FIELDS) : {});
  let rig = byScene.get(sceneId);
  if (rig === undefined) {
    rig = hash(canonical(content.shots.map((shot) => pick(shot.props, RIG_FRAME_FIELDS))));
    byScene.set(sceneId, rig);
  }
  return { cast, rig };
}

/** The fingerprints of what `department` touches in the scene now; '' each for a scene that isn't there. */
export function approvalBasis(records: Records, sceneId: string, department: string): ApprovalBasis {
  const content = sharedContent(records, sceneId);
  if (!content) return { current: '', v2: '', legacy: '' };
  const entries = content.shots.map((shot): JsonValue => {
    const status = isObject(shot.props.department_status) ? shot.props.department_status[department] : undefined;
    // Its notes and ticks: a tick that's off (`false`) or empty is the same as none.
    const own = isObject(status)
      ? Object.entries(status).filter(([key, value]) => !NOT_OWN.has(key) && value !== false && value !== null && value !== '')
      : [];
    // An entry with nothing of its own (only Priority, or emptied) is none, as a frame without one.
    return own.length > 0 ? Object.fromEntries(own) : null;
  });
  const own = `${department}|${canonical(entries)}`;
  const { cast, rig } = sceneExtras(records, sceneId, content);
  let legacy: string | undefined;
  return {
    current: `${CURRENT}${hash(`${content.shared}|${cast}|${RIG_DEPARTMENTS.has(department) ? rig : ''}|${own}`)}`,
    // Kept exactly as 3.15 computed it: approvals stored with `2:` depend on it.
    v2: `${V2}${hash(`${content.shared}|${own}`)}`,
    // Worked out only when an approval from before 3.15 is read: it reads the whole scene again.
    get legacy() {
      legacy ??= legacyBasis(records, sceneId, department);
      return legacy;
    },
  };
}

/**
 * A scene's `department_approvals` after a migration rewrote records from `before` to `after`, with every sign-off
 * that was current before it re-stamped by its own rule on `after`, so a format upgrade never shows "Changed since
 * approval" (Kevin Nov 9); undefined when none needs it. A sign-off that was already changed stays as it was, as does
 * everything this version can't read.
 */
export function approvalsKeptThrough(before: Records, after: Records, sceneId: string): JsonObject | undefined {
  const scene = after[sceneId];
  if (scene?.type !== 'scene' || before[sceneId]?.type !== 'scene') return undefined;
  const all = stored(scene.props);
  let touched = false;
  const out: JsonObject = {};
  for (const [department, list] of Object.entries(all)) {
    if (!Array.isArray(list)) {
      out[department] = list;
      continue;
    }
    let was: ApprovalBasis | undefined;
    let now: ApprovalBasis | undefined;
    const next: JsonValue[] = [];
    for (const value of list) {
      const approval = sceneApprovalOf(value);
      if (approval && isObject(value)) {
        was ??= approvalBasis(before, sceneId, department);
        now ??= approvalBasis(after, sceneId, department);
        const stamp = isCurrent(approval, was) && !isCurrent(approval, now) ? byRuleOf(approval.basis, now) : null;
        if (stamp) {
          touched = true;
          next.push({ ...value, basis: stamp });
          continue;
        }
      }
      next.push(value);
    }
    out[department] = next;
  }
  return touched ? out : undefined;
}

/** How a scene's approvals stand, for the marker on its heading (3.16): departments approved, and changed since. */
export interface SceneApprovalSummary {
  /** Departments whose every sign-off still matches the scene. */
  approved: number;
  /** Departments with a sign-off given before the scene changed. */
  changed: number;
}

const summaryCache = new WeakMap<Records, Map<string, SceneApprovalSummary>>();

/**
 * A scene's approvals counted by department, the departments this version shows (one a newer version added isn't in
 * the Inspector's table, so it isn't counted here); `only` narrows it to a focus view's departments, as the cards are.
 * Worked out once per set of records.
 */
export function sceneApprovalSummary(records: Records, sceneId: string, only: readonly string[] | null = null): SceneApprovalSummary {
  const scene = records[sceneId];
  if (scene?.type !== 'scene') return { approved: 0, changed: 0 };
  let byScene = summaryCache.get(records);
  if (!byScene) {
    byScene = new Map();
    summaryCache.set(records, byScene);
  }
  const key = `${scene.id}|${only?.join(',') ?? ''}`;
  const cached = byScene.get(key);
  if (cached) return cached;
  const summary = { approved: 0, changed: 0 };
  for (const [department, given] of Object.entries(sceneApprovals(scene.props))) {
    if (!isDepartment(department) || (only && !only.includes(department))) continue;
    const state = approvalState(given, approvalBasis(records, scene.id, department));
    if (state === 'approved') summary.approved += 1;
    else if (state === 'changed') summary.changed += 1;
  }
  byScene.set(key, summary);
  return summary;
}
