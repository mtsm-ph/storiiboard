import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore, useProject } from '../../app/projectStore';
import { editAuthor, useProfile } from '../../app/settings/profileStore';
import type { SbdRecord } from '../../core/model/record';
import { list } from '../../core/i18n';
import { suggestionGroups, sourceWord } from '../suggestions/review';
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
  suggestionSeqs,
  type FeedStep,
  type ReadState,
} from '../../core/storage/notifications';
import type { ProjectFile } from '../../core/storage/driver';

// Notifications (3.10): History's steps, with each person's read state. The steps aren't stored for this (CLAUDE.md:
// the feed is History); the read state is, outside the edit log (schema 10). Whose: the person picked with This is me,
// else `local`. Steps signed as you sign count as read: you made them. Kept in step with the project here, once, so the
// status bar's count and the tile agree; the log is read once a project, then only its new steps.
//
// "Yours" goes by the name a step is signed with (docs/PLAN.md, 3.10): until sign-in brings a stable id, steps signed
// before a rename read as someone else's, two people with no name (both `local`) read as one, and so do two with the
// same initials.
//
// Suggestions join the feed (7.2): one notification per import, at the place in the log of the step that brought it in,
// keyed by its first suggestion's id (`suggestion` in the read state, docs/SBD_FORMAT.md). It is unread until opened or
// Mark all read, even when the import was yours: it says there is something to review, which bringing it in didn't do.
// Its step is shown as it, never twice.

interface NotificationsState {
  /** The file read for: a project switched to starts again, never showing or writing another's. */
  file: object | null;
  userId: string;
  /** Who edits made here are signed as: a step signed so is yours. */
  me: string;
  /** Every step, oldest first. */
  steps: readonly FeedStep[];
  read: ReadState;
  /** Each import's notification, newest last. */
  suggestions: readonly SuggestionNote[];
}

/** One import's notification (7.2). */
export interface SuggestionNote {
  /** Its first suggestion's id: the item the read state names. */
  itemId: string;
  /** The change file's id: the group the Suggestions tile shows. */
  groupId: string;
  count: number;
  /** Who it's from, as text. */
  from: string;
  /** The place in the log of the step that brought it in. */
  seq: number;
}

export const notificationsStore = createStore<NotificationsState>()(() => ({ file: null, userId: LOCAL_READER, me: '', steps: [], read: NOTHING_READ, suggestions: [] }));

export const useNotifications = <T>(select: (state: NotificationsState) => T): T => useStore(notificationsStore, select);

/** Whether a step is unread for this person: not theirs, after their cursor, not read one by one. */
export function stepUnread(state: Pick<NotificationsState, 'me' | 'read'>, step: Pick<FeedStep, 'id' | 'seq' | 'author'>): boolean {
  return step.author !== state.me && isUnread(state.read, 'op_group', step.id, step.seq);
}

/** Whether an import's notification is unread for this person: after their cursor, not opened. Yours too (above). */
export const suggestionUnread = (state: Pick<NotificationsState, 'read'>, note: Pick<SuggestionNote, 'itemId' | 'seq'>): boolean =>
  isUnread(state.read, 'suggestion', note.itemId, note.seq);

/** The steps an import's notification stands for: shown and counted as it. */
export const coveredSteps = (state: Pick<NotificationsState, 'suggestions'>): ReadonlySet<number> => new Set(state.suggestions.map((note) => note.seq));

export const unreadCount = (state: NotificationsState): number => {
  const covered = coveredSteps(state);
  return state.steps.filter((s) => !covered.has(s.seq) && stepUnread(state, s)).length + state.suggestions.filter((note) => suggestionUnread(state, note)).length;
};

/** Each import of the project's suggestions, with its first suggestion's id; the place in the log is read apart. */
export function suggestionImports(records: Readonly<Record<string, SbdRecord>>, projectId: string): Omit<SuggestionNote, 'seq'>[] {
  return suggestionGroups(records, projectId)
    .flatMap((group) => {
      const first = group.ids[0];
      return first === undefined ? [] : [{ itemId: first, groupId: group.id, count: group.ids.length, from: group.authors.length > 0 ? list(group.authors) : sourceWord(group.source) }];
    })
    .reverse();
}

/** The imports with their places in the log, oldest first; one whose step isn't found (none) is left out. */
export async function suggestionNotes(file: ProjectFile, records: Readonly<Record<string, SbdRecord>>, projectId: string): Promise<SuggestionNote[]> {
  const imports = suggestionImports(records, projectId);
  const seqs = await suggestionSeqs(file, imports.map((note) => note.itemId));
  return imports
    .flatMap((note) => {
      const seq = seqs.get(note.itemId);
      return seq === undefined ? [] : [{ ...note, seq }];
    })
    .sort((a, b) => a.seq - b.seq);
}

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
      notificationsStore.setState({ file: null, steps: [], read: NOTHING_READ, suggestions: [] });
      return;
    }
    // Another project, or another reader: start again, showing nothing of the last one's while this one is read.
    const fresh = state.file !== project.file || state.userId !== userId;
    if (fresh) notificationsStore.setState({ file: project.file, userId, me, steps: [], read: NOTHING_READ, suggestions: [] });
    else if (state.me !== me) notificationsStore.setState({ me });
    const since = fresh ? 0 : (state.steps.at(-1)?.seq ?? 0);
    let live = true;
    void Promise.all([stepsSince(project.file, since), loadReadState(project.file, userId), suggestionNotes(project.file, records, project.projectId)])
      .then(([added, read, suggestions]) => {
        const now = notificationsStore.getState();
        if (!live || now.file !== project.file || now.userId !== userId) return;
        // Only steps after the last one held: an earlier read may have landed first.
        const last = now.steps.at(-1)?.seq ?? 0;
        notificationsStore.setState({ steps: [...now.steps, ...added.filter((s) => s.seq > last)], read: merged(read, now.read), suggestions });
      })
      // A read that fails leaves the last count: notifications are a convenience, never in the way of the work.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, records, canUndo, userId, me]);
}

/**
 * useNotificationSync as a component of its own that draws nothing (6.26), as MarkSeen is: it reads the records, so
 * every edit draws it again, and in the shell that drew the top bar, the sidebar and every tile again with it.
 */
export function NotificationSync(): null {
  useNotificationSync();
  return null;
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

/** An import's notification read, as its row is opened; nothing for one already read. Not an op. */
export async function markSuggestionRead(note: Pick<SuggestionNote, 'itemId' | 'seq'>): Promise<void> {
  const state = notificationsStore.getState();
  if (!current(state.userId) || !suggestionUnread(state, note)) return;
  const written = await projectStore.getState().writeAside([markReadStatement(state.userId, 'suggestion', note.itemId, new Date().toISOString())]);
  if (written && current(state.userId)) {
    notificationsStore.setState((s) => ({ read: { ...s.read, read: new Set([...s.read.read, readKey('suggestion', note.itemId)]) } }));
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
