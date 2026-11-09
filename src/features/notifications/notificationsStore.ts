import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore, useProject } from '../../app/projectStore';
import { editAuthor, useProfile } from '../../app/settings/profileStore';
import { useProjectSelf } from '../../app/settings/projectRole';
import {
  isUnread,
  LOCAL_READER,
  loadReadState,
  markAllReadStatements,
  markReadStatement,
  NOTHING_READ,
  readKey,
  stepsSince,
  type FeedStep,
  type ReadState,
} from '../../core/storage/notifications';

// Notifications (3.10): History's steps, with each person's read state. The steps aren't stored for this (CLAUDE.md:
// the feed is History); the read state is, outside the edit log (schema 10). Whose: the person picked with This is me,
// else `local`. Steps signed as you sign count as read: you made them. Kept in step with the project here, once, so the
// status bar's count and the tile agree; the log is read once a project, then only its new steps.
//
// "Yours" goes by the name a step is signed with (docs/PLAN.md, 3.10): until sign-in brings a stable id, steps signed
// before a rename read as someone else's, two people with no name (both `local`) read as one, and so do two with the
// same initials.

interface NotificationsState {
  /** The file read for: a project switched to starts again, never showing or writing another's. */
  file: object | null;
  userId: string;
  /** Who edits made here are signed as: a step signed so is yours. */
  me: string;
  /** Every step, oldest first. */
  steps: readonly FeedStep[];
  read: ReadState;
}

export const notificationsStore = createStore<NotificationsState>()(() => ({ file: null, userId: LOCAL_READER, me: '', steps: [], read: NOTHING_READ }));

export const useNotifications = <T>(select: (state: NotificationsState) => T): T => useStore(notificationsStore, select);

/** Whether a step is unread for this person: not theirs, after their cursor, not read one by one. */
export function stepUnread(state: Pick<NotificationsState, 'me' | 'read'>, step: Pick<FeedStep, 'id' | 'seq' | 'author'>): boolean {
  return step.author !== state.me && isUnread(state.read, 'op_group', step.id, step.seq);
}

export const unreadCount = (state: NotificationsState): number => state.steps.filter((s) => stepUnread(state, s)).length;

/** Who reads on this project: the live person picked with This is me, else `local`. */
function useReader(): string {
  const projectId = useProject((s) => s.project?.projectId);
  const self = useProjectSelf(projectId);
  const live = useProject((s) => {
    const person = self ? s.records[self] : undefined;
    return person?.type === 'person' && person.trashedAt === null && person.parentId === projectId;
  });
  return self && live ? self : LOCAL_READER;
}

/** Read state as loaded, with what was marked read since the load began: a late load never takes a read back. */
export function merged(loaded: ReadState, now: ReadState): ReadState {
  const through = loaded.readThrough === null ? now.readThrough : now.readThrough === null ? loaded.readThrough : Math.max(loaded.readThrough, now.readThrough);
  return { readThrough: through, read: new Set([...loaded.read, ...now.read]) };
}

/** Keeps the store in step: new steps after every edit, undo and restore; all again for another project or reader. */
export function useNotificationSync(): void {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const canUndo = useProject((s) => s.canUndo);
  const userId = useReader();
  const me = editAuthor(useProfile());
  useEffect(() => {
    const state = notificationsStore.getState();
    if (!project) {
      notificationsStore.setState({ file: null, steps: [], read: NOTHING_READ });
      return;
    }
    // Another project, or another reader: start again, showing nothing of the last one's while this one is read.
    const fresh = state.file !== project.file || state.userId !== userId;
    if (fresh) notificationsStore.setState({ file: project.file, userId, me, steps: [], read: NOTHING_READ });
    else if (state.me !== me) notificationsStore.setState({ me });
    const since = fresh ? 0 : (state.steps.at(-1)?.seq ?? 0);
    let live = true;
    void Promise.all([stepsSince(project.file, since), loadReadState(project.file, userId)])
      .then(([added, read]) => {
        const now = notificationsStore.getState();
        if (!live || now.file !== project.file || now.userId !== userId) return;
        // Only steps after the last one held: an earlier read may have landed first.
        const last = now.steps.at(-1)?.seq ?? 0;
        notificationsStore.setState({ steps: [...now.steps, ...added.filter((s) => s.seq > last)], read: merged(read, now.read) });
      })
      // A read that fails leaves the last count: notifications are a convenience, never in the way of the work.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, records, canUndo, userId, me]);
}

/** Whether the store is still the open project's, read for `userId`: a write lands for whoever it was made for, or not at all. */
const current = (userId: string): boolean => {
  const { file, userId: reader } = notificationsStore.getState();
  return file !== null && file === projectStore.getState().project?.file && reader === userId;
};

/** One step read, as its row is opened; nothing for one already read or yours. Not an op: never undone, never a step. */
export async function markStepRead(step: Pick<FeedStep, 'id' | 'seq' | 'author'>): Promise<void> {
  const state = notificationsStore.getState();
  if (!current(state.userId) || !stepUnread(state, step)) return;
  const written = await projectStore.getState().writeAside([markReadStatement(state.userId, 'op_group', step.id, new Date().toISOString())]);
  if (written && current(state.userId)) {
    notificationsStore.setState((s) => ({ read: { ...s.read, read: new Set([...s.read.read, readKey('op_group', step.id)]) } }));
  }
}

/** Every step so far read: the cursor moves to the newest step's place in the log. */
export async function markAllRead(): Promise<void> {
  const state = notificationsStore.getState();
  const newest = state.steps.at(-1);
  if (!current(state.userId) || !newest) return;
  const written = await projectStore.getState().writeAside(markAllReadStatements(state.userId, newest.seq, new Date().toISOString()));
  if (written && current(state.userId)) {
    notificationsStore.setState((s) => ({ read: { readThrough: Math.max(newest.seq, s.read.readThrough ?? 0), read: new Set() } }));
  }
}
