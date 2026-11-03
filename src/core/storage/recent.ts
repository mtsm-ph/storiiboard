import { isProjectState, type ProjectState } from '../model/project';
import type { AppDataStore } from './appData';

// The Recent list on the Projects screen (0.7) and in the sidebar's project switcher (D3). It holds paths on this
// computer, so it stays in the app's data folder and never goes into a project or to the web.

export interface RecentProject {
  path: string;
  name: string;
  /** ISO 8601, UTC. */
  openedAt: string;
  /** As of the last open or state change; lists written before 0.7b have none, which reads as active. */
  state?: ProjectState;
}

export const RECENT_FILE = 'recent.json';
export const MAX_RECENT = 20;

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.path === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.openedAt === 'string' &&
    (entry.state === undefined || isProjectState(entry.state))
  );
}

/** Newest first. A corrupt or hand-edited file reads as an empty list rather than stopping the app. */
export async function listRecent(store: AppDataStore): Promise<RecentProject[]> {
  try {
    const raw = await store.read(RECENT_FILE);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentProject) : [];
  } catch {
    return [];
  }
}

async function save(store: AppDataStore, list: RecentProject[]): Promise<RecentProject[]> {
  await store.write(RECENT_FILE, JSON.stringify(list, null, 2));
  return list;
}

/** Moves a project to the top of the list, adding it if it's new. */
export async function rememberRecent(store: AppDataStore, project: RecentProject): Promise<RecentProject[]> {
  const others = (await listRecent(store)).filter((entry) => entry.path !== project.path);
  return save(store, [project, ...others].slice(0, MAX_RECENT));
}

export async function forgetRecent(store: AppDataStore, path: string): Promise<RecentProject[]> {
  return save(
    store,
    (await listRecent(store)).filter((entry) => entry.path !== path),
  );
}

/** Records a project's new state in its entry, without moving it in the list. A path not in the list is left out. */
export async function setRecentState(store: AppDataStore, path: string, state: ProjectState): Promise<RecentProject[]> {
  const entries = await listRecent(store);
  if (!entries.some((entry) => entry.path === path && entry.state !== state)) return entries;
  return save(
    store,
    entries.map((entry) => (entry.path === path ? { ...entry, state } : entry)),
  );
}
