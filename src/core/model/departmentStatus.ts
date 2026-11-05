import { labels, list, t } from '../i18n';
import { DEPARTMENTS, type Department } from './department';
import type { JsonValue, Props } from './record';
import { isRole, type Role } from './role';

// Department status per shot (polish 6, Kevin Nov 5). Every department is involved in every shot; what a shot keeps
// is how far each one has got with it:
// - Priority: the departments this shot depends on most, listed first. Ticked by hand.
// - Seen: automatic, when someone from that department opens the shot (polish 6b; kept outside the edit log).
// - Working on it, Done: ticked by the department.
// - Approved: only the director or the DP can tick it, and it keeps who did. A person who is both counts once.
//
// Stored in the shot's `department_status` prop, by department id, with only what's set:
//   { "camera": { "priority": true, "done": true, "approvals": [{ "name": "Kevin Matos", "roles": ["dp"], "at": "…" }] } }
// Before polish 6 a shot kept `departments`, a list of the departments that were on. Migration 6 turns each into
// Priority; a shot read from an older point in History (Restore to here, Open version) still has the list, so it
// reads the same way here.

/** The states a department can be in on a shot, in the order the inspector's columns show them. */
export const DEPARTMENT_STATES = ['priority', 'seen', 'working', 'done', 'approved'] as const;
export type DepartmentState = (typeof DEPARTMENT_STATES)[number];

/** The states a person ticks by hand (Seen is automatic, Approved keeps who). */
export type TickedState = 'priority' | 'working' | 'done';

export const DEPARTMENT_STATE_LABELS: Readonly<Record<DepartmentState, string>> = labels({
  priority: 'departmentState.priority',
  seen: 'departmentState.seen',
  working: 'departmentState.working',
  done: 'departmentState.done',
  approved: 'departmentState.approved',
});

/** Who signs a shot's departments off. */
export const APPROVERS = ['director', 'dp'] as const;
export type Approver = (typeof APPROVERS)[number];

export const APPROVER_LABELS: Readonly<Record<Approver, string>> = labels({
  director: 'approver.director',
  dp: 'approver.dp',
});

/** As a sentence names them: "the director and DP". */
const APPROVER_IN_SENTENCE: Readonly<Record<Approver, string>> = labels({
  director: 'approver.directorInSentence',
  dp: 'approver.dpInSentence',
});

export interface Approval {
  /** The approver's name from their profile, as it was then; empty when they had none. */
  name: string;
  /** Director, DP, or both when one person holds the two roles: one tick, counted once. */
  roles: Approver[];
  /** When, as an ISO timestamp. */
  at: string;
  /** The approval as stored, written back as it was: a role or a field a newer version added stays. */
  raw?: Readonly<JsonObject>;
}

export interface DepartmentStatus {
  priority: boolean;
  working: boolean;
  done: boolean;
  approvals: Approval[];
  /** The entry as stored, so what a newer version keeps beside these (a field, an approver) is never dropped. */
  raw: Readonly<JsonObject>;
}

/** By department id. Ids this version doesn't know (a newer one's) are kept as they are, never dropped. */
export type DepartmentStatuses = Readonly<Record<string, DepartmentStatus>>;

const EMPTY: DepartmentStatus = { priority: false, working: false, done: false, approvals: [], raw: {} };

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const isApprover = (value: JsonValue): value is Approver => value === 'director' || value === 'dp';

function approvalOf(value: JsonValue): Approval | null {
  if (!isObject(value)) return null;
  const roles = Array.isArray(value.roles) ? [...new Set(value.roles.filter(isApprover))] : [];
  if (roles.length === 0) return null;
  return { name: typeof value.name === 'string' ? value.name : '', roles, at: typeof value.at === 'string' ? value.at : '', raw: value };
}

function statusOf(value: JsonValue): DepartmentStatus {
  if (!isObject(value)) return EMPTY;
  const approvals = Array.isArray(value.approvals) ? value.approvals.map(approvalOf).filter((a): a is Approval => a !== null) : [];
  return { priority: value.priority === true, working: value.working === true, done: value.done === true, approvals, raw: value };
}

const KNOWN = new Set(['priority', 'working', 'done', 'approvals']);
/** What an entry keeps that this version doesn't read: other fields, and approvals by roles it doesn't know. */
const unreadFields = (raw: Readonly<JsonObject>): JsonObject => Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN.has(key)));
const unreadApprovals = (raw: Readonly<JsonObject>): JsonValue[] =>
  Array.isArray(raw.approvals) ? raw.approvals.filter((a) => approvalOf(a) === null) : [];

const isSet = (status: DepartmentStatus) =>
  status.priority ||
  status.working ||
  status.done ||
  status.approvals.length > 0 ||
  Object.keys(unreadFields(status.raw)).length > 0 ||
  unreadApprovals(status.raw).length > 0;

/** A shot's department statuses, from its props; an older file's on/off departments read as Priority. */
export function departmentStatuses(props: Props): DepartmentStatuses {
  const stored = props.department_status;
  const out: Record<string, DepartmentStatus> = {};
  if (isObject(stored)) {
    for (const [id, value] of Object.entries(stored)) {
      const status = statusOf(value);
      if (isSet(status)) out[id] = status;
    }
    return out;
  }
  if (Array.isArray(props.departments)) {
    for (const id of props.departments) if (typeof id === 'string') out[id] = { ...EMPTY, priority: true };
  }
  return out;
}

/** "Kevin Matos (Director and DP)", or "the DP" when they had no name in their profile. */
export function approvalWho(approval: Approval): string {
  return approval.name
    ? t('departmentStatus.whoNamed', { name: approval.name, roles: list(approval.roles.map((role) => APPROVER_LABELS[role])) })
    : t('departmentStatus.whoRole', { roles: list(approval.roles.map((role) => APPROVER_IN_SENTENCE[role])) });
}

/** One department's status in words, as History lists it: "Priority, Done, approved by Kevin Matos (DP)", or —. */
export function statusText(value: JsonValue | undefined): string {
  if (value === undefined) return '—';
  const status = statusOf(value);
  const states = (['priority', 'working', 'done'] as const).filter((s) => status[s]).map((s) => DEPARTMENT_STATE_LABELS[s]);
  const approvals = status.approvals.map((a) => t('departmentStatus.approvedByWho', { who: approvalWho(a) }));
  return [...states, ...approvals].join(', ') || '—';
}

export const statusIn = (statuses: DepartmentStatuses, department: string): DepartmentStatus => statuses[department] ?? EMPTY;

/** Whether a department is in a state. Seen isn't kept here (see seenDepartments, polish 6b). */
export function hasState(status: DepartmentStatus, state: Exclude<DepartmentState, 'seen'>): boolean {
  return state === 'approved' ? status.approvals.length > 0 : status[state];
}

/** The prop as stored: only departments with something set, and in each only what's set. */
export function storedStatuses(statuses: DepartmentStatuses): JsonObject {
  const out: JsonObject = {};
  for (const [id, status] of Object.entries(statuses)) {
    if (!isSet(status)) continue;
    const entry: JsonObject = unreadFields(status.raw);
    if (status.priority) entry.priority = true;
    if (status.working) entry.working = true;
    if (status.done) entry.done = true;
    const approvals = [...status.approvals.map((a): JsonValue => a.raw ?? { name: a.name, roles: [...a.roles], at: a.at }), ...unreadApprovals(status.raw)];
    if (approvals.length > 0) entry.approvals = approvals;
    out[id] = entry;
  }
  return out;
}

/**
 * The edit that stores `next`, taking an older point in History's list off the shot as it goes (unsetting a prop the
 * shot doesn't have changes nothing, and History lists only what changed).
 */
export function departmentStatusChange(next: DepartmentStatuses): { set: Props; unset: string[] } {
  return { set: { department_status: storedStatuses(next) }, unset: ['departments'] };
}

/** `statuses` with one ticked state of one department turned on or off. */
export function withState(statuses: DepartmentStatuses, department: string, state: TickedState, on: boolean): DepartmentStatuses {
  return { ...statuses, [department]: { ...statusIn(statuses, department), [state]: on } };
}

/**
 * `statuses` after this person's Approved tick on a department. Each sign-off is its approver's: one made in a role
 * this person holds is theirs to take back; with none, theirs is added beside any other (the director's beside the
 * DP's). One person who is both makes one approval with both roles.
 */
export function withMyApproval(statuses: DepartmentStatuses, department: string, mine: Approval): DepartmentStatuses {
  const status = statusIn(statuses, department);
  const ours = (a: Approval) => a.roles.some((role) => mine.roles.includes(role));
  const approvals = status.approvals.some(ours) ? status.approvals.filter((a) => !ours(a)) : [...status.approvals, mine];
  return { ...statuses, [department]: { ...status, approvals } };
}

/** Whether this person's roles have approved a department already. */
export const approvedByMe = (status: DepartmentStatus, roles: readonly Approver[]): boolean =>
  status.approvals.some((a) => a.roles.some((role) => roles.includes(role)));

/** The departments in the inspector's order: Priority first, then the rest, each group in call-sheet order. */
export function orderedDepartments(statuses: DepartmentStatuses): Department[] {
  const priority = DEPARTMENTS.filter((d) => statusIn(statuses, d).priority);
  return [...priority, ...DEPARTMENTS.filter((d) => !statusIn(statuses, d).priority)];
}

/** The departments a shot depends on most, in call-sheet order; unknown ids after them, as stored. */
export function priorityDepartments(statuses: DepartmentStatuses): string[] {
  const known = DEPARTMENTS.filter((d) => statusIn(statuses, d).priority);
  const unknown = Object.keys(statuses).filter((id) => !(DEPARTMENTS as readonly string[]).includes(id) && statusIn(statuses, id).priority);
  return [...known, ...unknown];
}

/**
 * A person's role on one project (polish 6, Settings → Project): a role from the profile's list, or director and DP
 * together, for the many shoots where one person does both. Kept on this computer, by project.
 */
export type ProjectRole = Role | 'director-dp';

export const isProjectRole = (value: unknown): value is ProjectRole => value === 'director-dp' || isRole(value);

/** What a role signs off: one approval, for both roles at once when one person holds them. */
export function approverRoles(role: ProjectRole | null): Approver[] {
  if (role === 'director-dp') return ['director', 'dp'];
  return role === 'director' || role === 'dp' ? [role] : [];
}

/** The departments a role opens a shot for, so it can be marked Seen by them (polish 6b). */
export const ROLE_DEPARTMENTS: Readonly<Record<ProjectRole, readonly Department[]>> = {
  director: ['direction'],
  dp: ['camera'],
  'director-dp': ['direction', 'camera'],
  producer: ['production'],
  'first-ad': ['production'],
  gaffer: ['grip-electric'],
  'key-grip': ['grip-electric'],
  'production-designer': ['art'],
  hmu: ['hmu'],
  wardrobe: ['wardrobe'],
  sound: ['sound'],
  editor: ['post'],
  cast: ['cast'],
  client: ['client'],
  other: [],
};
