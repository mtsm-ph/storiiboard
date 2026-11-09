import { t } from '../i18n';
import { approvalOf, approvalWho, departmentStatuses, isObject, type Approval, type Approver, type JsonObject } from './departmentStatus';
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

export const isCurrent = (approval: SceneApproval, basis: string): boolean => approval.basis !== '' && approval.basis === basis;

export function approvalState(approvals: readonly SceneApproval[], basis: string): SceneApprovalState {
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
export function withMySceneApproval(props: Props, department: string, mine: Approval, basis: string): JsonObject | null {
  const all = stored(props);
  const list = Array.isArray(all[department]) ? all[department] : [];
  const isMine = (value: JsonValue) => {
    const approval = approvalOf(value);
    return approval !== null && ours(approval, mine.roles);
  };
  const current = list.map(sceneApprovalOf).find((a) => a !== null && ours(a, mine.roles) && isCurrent(a, basis));
  const kept = list.filter((value) => !isMine(value));
  const next: JsonValue[] = current ? kept : [...kept, { name: mine.name, roles: [...mine.roles], at: mine.at, basis }];
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
export function sceneApprovalLine(approvals: readonly SceneApproval[], basis: string): string {
  return approvals
    .map((a) => t(isCurrent(a, basis) ? 'departmentStatus.approvedByWho' : 'sceneApproval.approvedBefore', { who: approvalWho(a) }))
    .join(', ');
}

// What a department touches in a scene, for the fingerprint: the scene's own fields (heading, location, characters,
// length, palette); its frames and note cards in board order, each frame with its fields, its picture and its
// sketch; and that department's own Working on it and Done on each frame. Every department is involved in every frame
// (polish 6), so a frame's fields count for all of them. Left out: the approvals themselves, Priority (how much a
// frame depends on a department, not its content), Seen (automatic) and every other department's ticks.

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
  /** Everything but the departments' ticks, as canonical JSON. */
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

/** The fingerprint of what `department` touches in the scene now; '' for a scene that isn't there. */
export function approvalBasis(records: Records, sceneId: string, department: string): string {
  const content = sceneContent(records, sceneId);
  if (!content) return '';
  const ticks = content.shots.map((shot) => {
    const status = departmentStatuses(shot.props)[department];
    return [status?.working === true, status?.done === true];
  });
  return hash(`${content.shared}|${department}|${canonical(ticks)}`);
}
