import type { ThemePreference } from '../../core/storage/settings';

export type ResolvedTheme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(preference: ThemePreference, osPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return osPrefersDark ? 'dark' : 'light';
  return preference;
}

/** design/tokens/tokens.css keys its dark values off data-theme="dark" on <html>. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
}
