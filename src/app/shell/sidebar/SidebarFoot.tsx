import { t } from '../../../core/i18n';
import { IconButton } from '../../../ui/Button';
import { cx } from '../../../ui/cx';
import { GearGlyph } from '../../../ui/glyphs';
import { shownInitials, useProfile } from '../../settings/profileStore';
import { onNavKeyDown } from './navKeys';
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
      // Its ring inside, as the gear's and Hide sidebar's are, so it fits the 36px strip.
      className="flex size-[24px] shrink-0 items-center justify-center hover:bg-surface-raised focus-visible:-outline-offset-2"
    >
      <span
        aria-hidden="true"
        className={cx(
          'flex size-[22px] items-center justify-center rounded-full border border-text font-mono text-[10px] font-bold',
          initials === '' && 'border-dashed',
        )}
      >
        {initials}
      </span>
    </button>
  );
}

/**
 * The web companion's link, visible and to come: like the sections still to come, it's on the sidebar's arrow keys
 * (aria-disabled, not disabled), so a keyboard or screen-reader user hears that it arrives in Phase 9, without adding
 * a Tab stop. It goes nowhere yet; the site at that address still shows the old prototype.
 */
export function WebVersionItem() {
  return (
    <button
      type="button"
      data-nav-item=""
      tabIndex={-1}
      onKeyDown={onNavKeyDown}
      aria-disabled="true"
      className="sb-label flex h-9 w-full cursor-default items-center px-4 text-left text-text-muted focus-visible:-outline-offset-4"
    >
      {t('sidebar.web')}
      <span className="ml-auto">{t('phase.number', { phase: 9 })}</span>
    </button>
  );
}
