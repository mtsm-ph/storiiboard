import { useId, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { t } from '../../core/i18n';
import { initialsOf, isRole, ROLE_LABELS, ROLES } from '../../core/model/role';
import { loadSettings, MAX_PROFILE_NAME, saveSettings, type Profile } from '../../core/storage/settings';
import { Select, TextField } from '../../ui/fields';

// The local profile (polish C): the person on this computer, until accounts come with the web companion (Phase 9).
// Edited in Settings → Profile, shown on the sidebar's profile button, and written as the author of each edit, so a
// shared file's History says who did what.

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

/** Who an edit is by, as the file records it: the profile's name, or `local` until there is one. */
export function currentAuthor(): string {
  return profileStore.getState().name || 'local';
}

export function ProfileTab() {
  const profile = useProfile();
  const noteId = useId();
  // Typed fields save when left or on Enter, as the inspector's do.
  const [name, setName] = useState(profile.name);
  const [initials, setInitials] = useState(profile.initials);
  const commitName = () => {
    const next = name.trim().slice(0, MAX_PROFILE_NAME);
    setName(next);
    if (next !== profile.name) setProfile({ name: next });
  };
  const commitInitials = () => {
    const next = initials.trim().toLocaleUpperCase().slice(0, 3);
    setInitials(next);
    if (next !== profile.initials) setProfile({ initials: next });
  };
  return (
    <div className="flex max-w-[440px] flex-col gap-4 p-4">
      <TextField
        label={t('profile.name')}
        value={name}
        maxLength={MAX_PROFILE_NAME}
        aria-describedby={noteId}
        onChange={(event) => {
          setName(event.currentTarget.value);
        }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitName();
        }}
      />
      <TextField
        label={t('profile.initials')}
        value={initials}
        placeholder={initialsOf(name)}
        maxLength={3}
        onChange={(event) => {
          setInitials(event.currentTarget.value);
        }}
        onBlur={commitInitials}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitInitials();
        }}
      />
      <Select
        label={t('profile.role')}
        value={profile.role ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setProfile({ role: isRole(value) ? value : null });
        }}
      >
        <option value="">{t('profile.noRole')}</option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </Select>
      <p id={noteId} className="text-[12px] text-text-muted">
        {t('profile.note')}
      </p>
    </div>
  );
}
