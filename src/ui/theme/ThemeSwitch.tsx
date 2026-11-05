import type { ThemePreference } from '../../core/storage/settings';
import { SegmentedControl, type SegmentOption } from '../SegmentedControl';
import { useTheme } from './ThemeProvider';
import { t } from '../../core/i18n';

// Built as it renders, so the words follow the app's language.
const options = (): readonly SegmentOption<ThemePreference>[] => [
  { value: 'project', label: t('themeSwitch.project'), hint: t('themeSwitch.projectHint') },
  { value: 'system', label: t('themeSwitch.system') },
  { value: 'light', label: t('themeChooser.light') },
  { value: 'dark', label: t('themeChooser.dark') },
];

export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return <SegmentedControl size="sm" label={t('themeSwitch.theme')} options={options()} value={preference} onChange={setPreference} />;
}
