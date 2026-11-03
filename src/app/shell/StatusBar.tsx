import { version } from '../../../package.json';
import { ThemeSwitch } from '../../ui/theme/ThemeSwitch';
import type { Workspace } from './workspaces';

export function StatusBar({ workspace }: { workspace: Workspace }) {
  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-[18px] border-t border-border px-3">
      <span className="sb-label">
        <span aria-hidden="true">■ </span>Workspace: {workspace.label}
      </span>
      <div className="ml-auto flex items-center gap-[18px]">
        <ThemeSwitch />
        {/* Mono like every technical value, but not uppercased: a version reads "v0.1.0". */}
        <span className="font-mono text-[10px] tracking-[0.08em] text-text-muted">v{version}</span>
      </div>
    </footer>
  );
}
