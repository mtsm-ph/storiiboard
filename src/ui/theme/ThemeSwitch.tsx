import type { ThemePreference } from '../../core/storage/settings';
import { SegmentedControl, type SegmentOption } from '../SegmentedControl';
import { useTheme } from './ThemeProvider';

const OPTIONS: readonly SegmentOption<ThemePreference>[] = [
  { value: 'project', label: 'Project' },
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return <SegmentedControl size="sm" label="Theme" options={OPTIONS} value={preference} onChange={setPreference} />;
}
