// App settings that belong to the person, not the project: they never go into a .sbd file.
// They stay in the webview's localStorage, which the app keeps in its own data folder: public/theme-boot.js has to
// read the theme synchronously before first paint, which a file behind a Rust command can't offer. Lists that other
// tools may read, like the recent projects, go in app data files instead (appData.ts).

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
}

/** Read before first paint by public/theme-boot.js too; keep the two in step. */
export const SETTINGS_KEY = 'storiiboard.settings';

export const DEFAULT_SETTINGS: Settings = { theme: 'system' };

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
  return value === 'system' || value === 'light' || value === 'dark';
}

export function loadSettings(storage: Reader | undefined = browserStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    const theme = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).theme : undefined;
    return { theme: isThemePreference(theme) ? theme : DEFAULT_SETTINGS.theme };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
