import { useId } from 'react';
import { t } from '../../core/i18n';
import { initialsOf, isRole, ROLE_LABELS, ROLES, type Role } from '../../core/model/role';
import { cleanProfileText, MAX_PROFILE_NAME } from '../../core/storage/settings';
import { Select, TextField, Toggle } from '../../ui/fields';
import { useDraft } from './drafts';
import { setProfile, useProfile } from './profileStore';

// Settings → Profile (polish C): the person's name, initials and usual role, kept on this computer (profileStore.ts).
// The name, or the initials if they choose, also goes with each edit they make, so History says who (Kevin, Nov 5).
// Each waits for Apply changes (drafts.ts), as every setting of this computer's in the Settings window.

/** Initials as kept: upper-cased first, then cut, so ß becomes SS and the ring holds three letters at most. */
const cleanInitials = (text: string): string => cleanProfileText(text.toLocaleUpperCase(), 3);
const cleanName = (text: string): string => cleanProfileText(text, MAX_PROFILE_NAME);

export function ProfileTab() {
  const profile = useProfile();
  const noteId = useId();
  const historyNoteId = useId();
  // Typed fields keep what is typed as the draft, cleaned when left or on Enter; Apply writes it cleaned either way.
  const [name, draftName] = useDraft('profile.name', profile.name, (next: string) => {
    setProfile({ name: cleanName(next) });
  });
  const [initials, draftInitials] = useDraft('profile.initials', profile.initials, (next: string) => {
    setProfile({ initials: cleanInitials(next) });
  });
  const [role, draftRole] = useDraft<Role | null>('profile.role', profile.role, (next) => {
    setProfile({ role: next });
  });
  const [historyInitials, draftHistoryInitials] = useDraft('profile.historyInitials', profile.historyInitials, (next: boolean) => {
    setProfile({ historyInitials: next });
  });
  return (
    <div className="flex max-w-[440px] flex-col gap-4 p-4">
      <TextField
        label={t('profile.name')}
        value={name}
        maxLength={MAX_PROFILE_NAME}
        aria-describedby={`${noteId} ${historyNoteId}`}
        onChange={(event) => {
          draftName(event.currentTarget.value);
        }}
        onBlur={() => {
          draftName(cleanName(name));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') draftName(cleanName(name));
        }}
      />
      <TextField
        label={t('profile.initials')}
        value={initials}
        placeholder={initialsOf(name)}
        maxLength={3}
        aria-describedby={historyNoteId}
        onChange={(event) => {
          draftInitials(event.currentTarget.value);
        }}
        onBlur={() => {
          draftInitials(cleanInitials(initials));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') draftInitials(cleanInitials(initials));
        }}
      />
      <Select
        label={t('profile.role')}
        value={role ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          draftRole(isRole(value) ? value : null);
        }}
      >
        <option value="">{t('profile.noRole')}</option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <Toggle label={t('profile.historyInitials')} checked={historyInitials} onChange={draftHistoryInitials} />
      <p id={historyNoteId} className="text-[12px] text-text-muted">
        {t('profile.historyNote')}
      </p>
      <p id={noteId} className="text-[12px] text-text-muted">
        {t('profile.note')}
      </p>
    </div>
  );
}
