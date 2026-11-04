import { DEFAULT_KEEP, type BackupKeep } from './backups';

// App settings that belong to the person, not the project: they never go into a .sbd file.
// They stay in the webview's localStorage, which the app keeps in its own data folder: public/theme-boot.js has to
// read the theme synchronously before first paint, which a file behind a Rust command can't offer. Lists that other
// tools may read, like the recent projects, go in app data files instead (appData.ts).

/** `project`, Follow project (the default since 1.15): the open project's own mode, or the OS with none open. */
export type ThemePreference = 'project' | 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  /** How many backups to keep (CLAUDE.md: both numbers are in Settings). */
  backups: BackupKeep;
  /** Projects already told they're in a synced folder: the note shows once per project (src/app/projects/synced.ts). */
  syncNoted: string[];
  /** Keep a synced project's backups next to it, rather than in a folder on this computer (the default). */
  backupsNextToProject: boolean;
}

/** The newest this many noted projects are remembered; an older one would be noted again, which is harmless. */
export const MAX_SYNC_NOTED = 500;

/** The ranges the Backups tile accepts. Keeping no recent copies would leave nothing to open. */
export const KEEP_LIMITS = { recent: { min: 1, max: 500 }, days: { min: 0, max: 365 } } as const;

function keepValue(value: unknown, field: keyof BackupKeep): number {
  const { min, max } = KEEP_LIMITS[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : DEFAULT_KEEP[field];
}

/** Read before first paint by public/theme-boot.js too; keep the two in step. */
export const SETTINGS_KEY = 'storiiboard.settings';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'project',
  backups: { ...DEFAULT_KEEP },
  syncNoted: [],
  backupsNextToProject: false,
};

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Storage can be blocked (private mode, sandboxing); the app still runs on defaults.
    return undefined;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'project' || value === 'system' || value === 'light' || value === 'dark';
}

export function loadSettings(storage: Reader | undefined = browserStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, backups: { ...DEFAULT_KEEP }, syncNoted: [] };
    const parsed: unknown = JSON.parse(raw);
    const saved = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const backups = typeof saved.backups === 'object' && saved.backups !== null ? (saved.backups as Record<string, unknown>) : {};
    return {
      theme: isThemePreference(saved.theme) ? saved.theme : DEFAULT_SETTINGS.theme,
      // Each number falls back on its own, so one bad value never costs the other.
      backups: { recent: keepValue(backups.recent, 'recent'), days: keepValue(backups.days, 'days') },
      syncNoted: Array.isArray(saved.syncNoted)
        ? saved.syncNoted.filter((p): p is string => typeof p === 'string').slice(-MAX_SYNC_NOTED)
        : [],
      backupsNextToProject: saved.backupsNextToProject === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, backups: { ...DEFAULT_KEEP }, syncNoted: [] };
  }
}

export function saveSettings(patch: Partial<Settings>, storage: Writer | undefined = browserStorage()): Settings {
  const next = { ...loadSettings(storage), ...patch };
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store only loses the preference, never the session.
  }
  return next;
}
