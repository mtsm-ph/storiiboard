import { DEFAULT_LOCALE, isLocaleId, type LocaleId } from '../i18n';
import { isProjectRole, type ProjectRole } from '../model/departmentStatus';
import { companyProfilesOf, type CompanyProfile } from '../model/company';
import { DEPARTMENTS, type Department } from '../model/department';
import { isRole, type Role } from '../model/role';
import { DEFAULT_KEEP, type BackupKeep } from './backups';

// App settings that belong to the person, not the project: they never go into a .sbd file.
// They stay in the webview's localStorage, which the app keeps in its own data folder: public/theme-boot.js has to
// read the theme synchronously before first paint, which a file behind a Rust command can't offer. Lists that other
// tools may read, like the recent projects, go in app data files instead (appData.ts).

/**
 * The person on this computer (polish C), kept in these settings. Their name (or initials) also goes with each edit
 * they make into the project file's History (Kevin, Nov 5). Local until accounts come with the web companion (Phase 9).
 * Empty until they fill it in.
 */
export interface Profile {
  name: string;
  /** As the avatar shows them; worked out from the name until typed. */
  initials: string;
  /** Their usual role; a project's own "Your role" (polish 6) overrides it there. */
  role: Role | null;
  /** Edits carry the initials rather than the name, for people who'd rather not share their name. */
  historyInitials: boolean;
}

export const EMPTY_PROFILE: Profile = { name: '', initials: '', role: null, historyInitials: false };

/** At most this long, in characters: a name has to fit the sidebar's tooltip. */
export const MAX_PROFILE_NAME = 60;

/**
 * Profile text as kept: trimmed, without control or direction-override characters (which would flip the text beside a
 * name), and cut to `max` characters as people count them, never through the middle of an emoji.
 */
export function cleanProfileText(text: string, max: number): string {
  // Control characters and the bidi overrides and isolates; joiners stay (ZWJ in emoji, ZWNJ in Persian names).
  return Array.from(text.replace(/[\p{Cc}‪-‮⁦-⁩‎‏؜]/gu, '').trim())
    .slice(0, max)
    .join('')
    .trim();
}

function profileOf(value: unknown): Profile {
  const saved = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const text = (v: unknown, max: number) => (typeof v === 'string' ? cleanProfileText(v, max) : '');
  return {
    name: text(saved.name, MAX_PROFILE_NAME),
    initials: text(saved.initials, 3),
    role: isRole(saved.role) ? saved.role : null,
    historyInitials: saved.historyInitials === true,
  };
}

/** `project`, Follow project (the default since 1.15): the open project's own mode, or the OS with none open. */
export type ThemePreference = 'project' | 'system' | 'light' | 'dark';

/** Where the week starts (3.17): as this computer's region says, or Sunday or Monday whatever it says. */
export type WeekStartChoice = 'region' | 'sunday' | 'monday';
export const isWeekStartChoice = (value: unknown): value is WeekStartChoice => value === 'region' || value === 'sunday' || value === 'monday';

/** The units the call sheet's forecast is written in (4.4): by this computer's region, or metric or US whatever it says. */
export type WeatherUnitsChoice = 'region' | 'metric' | 'us';
export const isWeatherUnitsChoice = (value: unknown): value is WeatherUnitsChoice => value === 'region' || value === 'metric' || value === 'us';

/** The paper a call sheet's PDF is made for (4.6): by this computer's region, or Letter or A4 whatever it says. */
export type PaperChoice = 'region' | 'letter' | 'a4';
export const isPaperChoice = (value: unknown): value is PaperChoice => value === 'region' || value === 'letter' || value === 'a4';

/** The map app a call sheet's directions link opens (4.6, Settings → App). */
export type DirectionsApp = 'google' | 'apple' | 'osm';
export const isDirectionsApp = (value: unknown): value is DirectionsApp => value === 'google' || value === 'apple' || value === 'osm';

export interface Settings {
  theme: ThemePreference;
  /**
   * The theme was picked in the app (since 1.15). Before then every save wrote `system` along with whatever else
   * changed, so a `system` without this was the old default, not a choice, and reads as the new one.
   */
  themeChosen: boolean;
  /** How many backups to keep (CLAUDE.md: both numbers are in Settings). */
  backups: BackupKeep;
  /** Projects already told they're in a synced folder: the note shows once per project (src/app/projects/synced.ts). */
  syncNoted: string[];
  /** Keep a synced project's backups next to it, rather than in a folder on this computer (the default). */
  backupsNextToProject: boolean;
  /** The app's language (Settings → App). The person's, never the project's: a shared .sbd opens in each one's own. */
  language: LocaleId;
  /** Where the Calendar's week starts (3.17, Settings → App), in every language. */
  weekStart: WeekStartChoice;
  /** The forecast's units (4.4, Settings → App); the cache keeps MET's metric values. */
  weatherUnits: WeatherUnitsChoice;
  /** The paper a call sheet's PDF is made for (4.6, the Call sheet tile's Paper choice). */
  callSheetPaper: PaperChoice;
  /** Directions open in (4.6, Settings → App): the app a call sheet's directions link and QR code open. */
  directionsApp: DirectionsApp;
  /** The sidebar folded to its strip (polish 2), as the person last left it. */
  sidebarHidden: boolean;
  profile: Profile;
  /**
   * "Your role on this project" (polish 6, Settings → Project), by project id: it takes the place of the profile's
   * usual role there, until people and roles come with Phase 3. The person's, so it stays on this computer.
   */
  projectRoles: Readonly<Record<string, ProjectRole>>;
  /**
   * Who you are in each project's Cast and crew (3.5c), by project id: a person record's id. Their role and departments
   * then take the place of `projectRoles` for approvals and Seen. Yours, so it stays on this computer, never in the file.
   */
  projectSelves: Readonly<Record<string, string>>;
  /** The PDF storyboard prints each scene's palette in its heading (polish PP), as last chosen in Export. */
  pdfScenePalettes: boolean;
  /** Production companies saved once, to attach to any project (3.2); attaching copies one into the project. */
  companies: CompanyProfile[];
  /**
   * The department workspaces the sidebar lists (3.6a), opened from a department's row on a frame. The person's, as
   * their layouts are, so every project shows the same ones.
   */
  departmentWorkspaces: Department[];
  /**
   * The person's own workspaces (3.6d), in the sidebar's order: an id (`custom-` and a UUID), a name, and the layout
   * it was made from, as JSON the shell checks before using (src/app/shell/workspaceStore.ts). Theirs, as their
   * layouts are.
   */
  customWorkspaces: SavedCustomWorkspace[];
  /**
   * Tiles added to a built-in workspace's default since layouts could be saved (src/app/shell/docking/layoutStore.ts,
   * `TILES_ADDED`), as `workspace:tile`, once each has been put in this computer's saved layout. Offered once, so a tile
   * the person then closes stays closed.
   */
  tilesOffered: string[];
}

export interface SavedCustomWorkspace {
  id: string;
  name: string;
  layout: unknown;
  /** The tiles' numbering, as tile ids; checked by the shell. */
  order?: unknown;
}

/** At most this many workspaces of the person's own; the newest are kept. */
export const MAX_CUSTOM_WORKSPACES = 50;

/** Named entries with a `custom-` id, each once, the newest kept; the layout is checked by the shell. */
function customWorkspacesOf(value: unknown): SavedCustomWorkspace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const kept: SavedCustomWorkspace[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, layout, order } = entry as Record<string, unknown>;
    // Cleaned as a profile's name is: no direction overrides to flip the sidebar, at most MAX_PROFILE_NAME long.
    const clean = typeof name === 'string' ? cleanProfileText(name, MAX_PROFILE_NAME) : '';
    if (typeof id !== 'string' || !id.startsWith('custom-') || seen.has(id) || clean === '') continue;
    seen.add(id);
    kept.push({ id, name: clean, layout, ...(order === undefined ? {} : { order }) });
  }
  return kept.slice(-MAX_CUSTOM_WORKSPACES);
}

/** The newest this many noted projects are remembered; an older one would be noted again, which is harmless. */
export const MAX_SYNC_NOTED = 500;

/** The newest this many projects' roles are remembered; an older one falls back to the usual role. */
export const MAX_PROJECT_ROLES = 500;

function projectRolesOf(value: unknown): Record<string, ProjectRole> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const kept = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, ProjectRole] => isProjectRole(entry[1]));
  return Object.fromEntries(kept.slice(-MAX_PROJECT_ROLES));
}

/** Each project's pick of who you are in its Cast and crew: ids as text, the newest kept. */
function projectSelvesOf(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const kept = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
  );
  return Object.fromEntries(kept.slice(-MAX_PROJECT_ROLES));
}

/** The departments this version knows, each once, in the call sheet's order; anything else is left out. */
function departmentWorkspacesOf(value: unknown): Department[] {
  if (!Array.isArray(value)) return [];
  return DEPARTMENTS.filter((d) => value.includes(d));
}

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
  themeChosen: false,
  backups: { ...DEFAULT_KEEP },
  syncNoted: [],
  backupsNextToProject: false,
  language: DEFAULT_LOCALE,
  weekStart: 'region',
  weatherUnits: 'region',
  callSheetPaper: 'region',
  directionsApp: 'google',
  sidebarHidden: false,
  profile: EMPTY_PROFILE,
  projectRoles: {},
  projectSelves: {},
  pdfScenePalettes: false,
  companies: [],
  departmentWorkspaces: [],
  customWorkspaces: [],
  tilesOffered: [],
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
    const themeChosen = saved.themeChosen === true;
    const theme = isThemePreference(saved.theme) && (saved.theme !== 'system' || themeChosen) ? saved.theme : DEFAULT_SETTINGS.theme;
    return {
      theme,
      themeChosen,
      // Each number falls back on its own, so one bad value never costs the other.
      backups: { recent: keepValue(backups.recent, 'recent'), days: keepValue(backups.days, 'days') },
      syncNoted: Array.isArray(saved.syncNoted)
        ? saved.syncNoted.filter((p): p is string => typeof p === 'string').slice(-MAX_SYNC_NOTED)
        : [],
      backupsNextToProject: saved.backupsNextToProject === true,
      // A language this version doesn't have (saved by a newer one, say) reads as the default.
      language: isLocaleId(saved.language) ? saved.language : DEFAULT_LOCALE,
      weekStart: isWeekStartChoice(saved.weekStart) ? saved.weekStart : 'region',
      weatherUnits: isWeatherUnitsChoice(saved.weatherUnits) ? saved.weatherUnits : 'region',
      callSheetPaper: isPaperChoice(saved.callSheetPaper) ? saved.callSheetPaper : 'region',
      directionsApp: isDirectionsApp(saved.directionsApp) ? saved.directionsApp : 'google',
      sidebarHidden: saved.sidebarHidden === true,
      profile: profileOf(saved.profile),
      projectRoles: projectRolesOf(saved.projectRoles),
      projectSelves: projectSelvesOf(saved.projectSelves),
      pdfScenePalettes: saved.pdfScenePalettes === true,
      companies: companyProfilesOf(saved.companies),
      departmentWorkspaces: departmentWorkspacesOf(saved.departmentWorkspaces),
      customWorkspaces: customWorkspacesOf(saved.customWorkspaces),
      tilesOffered: Array.isArray(saved.tilesOffered)
        ? [...new Set(saved.tilesOffered.filter((k): k is string => typeof k === 'string'))]
        : [],
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
