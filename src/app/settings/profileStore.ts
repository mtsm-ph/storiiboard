import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { initialsOf } from '../../core/model/role';
import { loadSettings, saveSettings, type Profile } from '../../core/storage/settings';

// The local profile (polish C): the person on this computer, until accounts come with the web companion (Phase 9).
// Kept in this computer's app settings and shown on the sidebar's profile button. It is never written into a project
// file: whether edits carry a name (and in which form) is Kevin's call, asked at review stop 1, so History's own steps
// still read "You".

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
