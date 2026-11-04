import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useMemo, type ReactNode } from 'react';
import { PAPER } from '../ui/theme/generator/families';
import { readProjectTheme } from '../ui/theme/projectTheme';
import { ThemeProvider } from '../ui/theme/ThemeProvider';
import { isTauriApp } from './fileAccess';
import { useProject } from './projectStore';

// The open project's theme (1.15) for the whole app: its tokens on <html>, its preferred mode for Follow project, and
// its background for the window behind the page, so resizing a dark project never shows paper at the edges.

function setWindowBackground(colour: string | null) {
  if (!isTauriApp) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  // With no project theme, the kit's own backgrounds: the generator's Paper family holds them as values.
  const value = colour ?? (dark ? PAPER.dark.bg : PAPER.light.bg);
  // The window and the webview both: Windows paints the webview's own layer at the edges while resizing, macOS the
  // window's. Best effort: a webview without either keeps its colour.
  getCurrentWebviewWindow()
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
