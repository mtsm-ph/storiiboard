import { t } from '../../../core/i18n';
import { IconButton } from '../../../ui/Button';
import { cx } from '../../../ui/cx';
import { GearGlyph } from '../../../ui/glyphs';
import { shownInitials, useProfile } from '../../settings/profile';
import { openSettings } from '../../settings/SettingsWindow';
import { isMac } from '../undoShortcuts';

// The sidebar's foot (polish C), and what of it stays in the folded strip: Settings behind a gear, the person's
// profile, and the web version still to come.

/** Settings, in its window: the gear opens it at the tab last open, as ⌘, does. */
export function GearButton() {
  const keys = isMac() ? { label: '⌘,', aria: 'Meta+,' } : { label: 'Ctrl+,', aria: 'Control+,' };
  return (
    <IconButton
      size="sm"
      label={t('sidebar.gear', { keys: keys.label })}
      aria-keyshortcuts={keys.aria}
      onClick={() => {
        openSettings();
      }}
    >
      <GearGlyph />
    </IconButton>
  );
}

/**
 * The person on this computer: their initials in a ring, the one round shape inside the app (theme.css keeps
 * rounded-full for avatars). Empty, a dashed ring that asks for a profile. It opens Settings → Profile.
 */
export function ProfileButton() {
  const profile = useProfile();
  const initials = shownInitials(profile);
  return (
    <button
      type="button"
      aria-label={profile.name ? t('sidebar.profile', { name: profile.name }) : t('sidebar.profileEmpty')}
      title={profile.name || t('sidebar.profileEmpty')}
      onClick={() => {
        openSettings('profile');
      }}
      className="flex size-[24px] shrink-0 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className={cx(
          'flex size-[22px] items-center justify-center rounded-full border border-text font-mono text-[9px] font-bold',
          initials === '' && 'border-dashed',
        )}
      >
        {initials}
      </span>
    </button>
  );
}

/**
 * The web companion's link, visible and to come: it stays focusable (aria-disabled), so a keyboard or screen-reader
 * user hears that it arrives in Phase 9. It goes nowhere yet; the site at that address still shows the old prototype.
 */
export function WebVersionItem() {
  return (
    <button
      type="button"
      aria-disabled="true"
      className="sb-label flex h-9 w-full cursor-default items-center px-4 text-left text-text-muted focus-visible:-outline-offset-4"
    >
      {t('sidebar.web')}
      <span className="ml-auto">{t('phase.number', { phase: 9 })}</span>
    </button>
  );
}
