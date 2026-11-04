import type { ThemePreference } from '../../core/storage/settings';
import { SegmentedControl, type SegmentOption } from '../SegmentedControl';
import { useTheme } from './ThemeProvider';

const OPTIONS: readonly SegmentOption<ThemePreference>[] = [
  { value: 'project', label: 'Project', hint: 'Follows the open project’s mode, or the system’s with none open' },
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return <SegmentedControl size="sm" label="Theme" options={OPTIONS} value={preference} onChange={setPreference} />;
}
