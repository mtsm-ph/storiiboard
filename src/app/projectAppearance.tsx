import { getCurrentWindow } from '@tauri-apps/api/window';
import { useMemo, type ReactNode } from 'react';
import { readProjectTheme } from '../ui/theme/projectTheme';
import { ThemeProvider } from '../ui/theme/ThemeProvider';
import { isTauriApp } from './fileAccess';
import { useProject } from './projectStore';

// The open project's theme (1.15) for the whole app: its tokens on <html>, its preferred mode for Follow project, and
// its background for the window behind the page, so resizing a dark project never shows paper at the edges.

/** The kit's backgrounds, light and dark, when no project theme is set (design/tokens/tokens.css). */
const KIT_BACKGROUND = { light: '#EEE9DF', dark: '#1B2632' } as const;

function setWindowBackground(colour: string | null) {
  if (!isTauriApp) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const value = colour ?? (dark ? KIT_BACKGROUND.dark : KIT_BACKGROUND.light);
  // Best effort: an older webview without it keeps the window's own colour.
  getCurrentWindow()
    .setBackgroundColor(value)
    .catch(() => undefined);
}

export function ProjectAppearance({ children }: { children: ReactNode }) {
  const prop = useProject((s) => (s.project ? s.records[s.project.projectId]?.props.theme : undefined));
  // Read again only when the stored theme changes, not on every edit.
  const key = JSON.stringify(prop ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theme = useMemo(() => readProjectTheme(prop), [key]);
  return (
    <ThemeProvider projectTheme={theme} onBackground={setWindowBackground}>
      {children}
    </ThemeProvider>
  );
}
