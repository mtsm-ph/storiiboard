import type { ThemePreference } from '../../core/storage/settings';

export type ResolvedTheme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Light or dark, from the person's Appearance setting. Follow project takes the open project's own mode, and the
 * OS's while no project (or one without a theme) is open.
 */
export function resolveTheme(preference: ThemePreference, osPrefersDark: boolean, projectMode: ResolvedTheme | null = null): ResolvedTheme {
  if (preference === 'project' && projectMode) return projectMode;
  if (preference === 'system' || preference === 'project') return osPrefersDark ? 'dark' : 'light';
  return preference;
}

/** design/tokens/tokens.css keys its dark values off data-theme="dark" on <html>. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
}
