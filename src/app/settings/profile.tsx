import { useId, useState } from 'react';
import { t } from '../../core/i18n';
import { initialsOf, isRole, ROLE_LABELS, ROLES } from '../../core/model/role';
import { cleanProfileText, MAX_PROFILE_NAME } from '../../core/storage/settings';
import { Select, TextField, Toggle } from '../../ui/fields';
import { setProfile, useProfile } from './profileStore';

// Settings → Profile (polish C): the person's name, initials and usual role, kept on this computer (profileStore.ts).
// The name, or the initials if they choose, also goes with each edit they make, so History says who (Kevin, Nov 5).

export function ProfileTab() {
  const profile = useProfile();
  const noteId = useId();
  // Typed fields save when left or on Enter, as the inspector's do.
  const [name, setName] = useState(profile.name);
  const [initials, setInitials] = useState(profile.initials);
  const commitName = () => {
    const next = cleanProfileText(name, MAX_PROFILE_NAME);
    setName(next);
    if (next !== profile.name) setProfile({ name: next });
  };
  const commitInitials = () => {
    // Upper-cased first, then cut: ß becomes SS, and the ring holds three letters at most.
    const next = cleanProfileText(initials.toLocaleUpperCase(), 3);
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
      <Toggle
        label={t('profile.historyInitials')}
        checked={profile.historyInitials}
        onChange={(on) => {
          setProfile({ historyInitials: on });
        }}
      />
      <p id={noteId} className="text-[12px] text-text-muted">
        {t('profile.note')}
      </p>
    </div>
  );
}
