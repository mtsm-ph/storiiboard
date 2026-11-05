import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { initialsOf } from '../../core/model/role';
import { loadSettings, saveSettings, type Profile } from '../../core/storage/settings';

// The local profile (polish C): the person on this computer, until accounts come with the web companion (Phase 9).
// Kept in this computer's app settings and shown on the sidebar's profile button. Each edit they make carries their
// name, or their initials if they choose (Kevin, Nov 5), so History says who; anyone they share the file with sees it.

export const profileStore = createStore<Profile>()(() => loadSettings().profile);

export function setProfile(patch: Partial<Profile>): void {
  const next = { ...profileStore.getState(), ...patch };
  profileStore.setState(next);
  saveSettings({ profile: next });
}

export function useProfile(): Profile {
  return useStore(profileStore);
}

/** The initials the avatar shows: typed, or worked out from the name. Empty with no profile yet. */
export function shownInitials(profile: Profile): string {
  return profile.initials || initialsOf(profile.name);
}

/** What an edit made in the project file, by the edit log's own word for no name at all (docs/SBD_FORMAT.md). */
export const NO_AUTHOR = 'local';

/**
 * Who an edit is by, as the project file records it: the profile's name, or its initials when the person chose that
 * (or when there's no name, only initials). With neither, no name (`local`), as every edit before names were kept.
 * A name of exactly "local" reads as no name too: the log's own word (docs/SBD_FORMAT.md).
 */
export function editAuthor(profile: Profile): string {
  const said = profile.historyInitials || profile.name === '' ? shownInitials(profile) : profile.name;
  return said === '' ? NO_AUTHOR : said;
}
