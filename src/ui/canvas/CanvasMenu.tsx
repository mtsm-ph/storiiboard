import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import { commandShortcut, MenuGroup, MenuItem } from '../Menu';
import type { AlignMode, Axis, CanvasCommand, Point, TidyMode } from './types';

// The right-click menu (decision 11), also opened by Shift+F10 or the menu key: Copy, Cut, Paste, Duplicate, Delete and
// the four z-order moves. A panel of buttons like the app's other menus (src/ui/Menu.tsx); Escape closes it and
// focus goes back to the canvas.

interface CanvasMenuProps {
  /** Where it opens, in pixels from the canvas's top left. */
  at: Point;
  hasSelection: boolean;
  /** How many items are selected (connectors left out): the layout commands need two, or three to distribute. */
  items: number;
  /** Whether a section is among the selection: its contents can be selected. */
  hasSection: boolean;
  /** The canvas's height: the panel moves up to fit, and scrolls if it is taller than that. */
  canvasHeight: number;
  canPaste: boolean;
  mac: boolean;
  onCommand: (command: CanvasCommand) => void;
  onSelectContents: () => void;
  onClose: () => void;
}

const ALIGNS: readonly { mode: AlignMode; code: string; label: () => string }[] = [
  { mode: 'left', code: 'A', label: () => t('canvas.align.left') },
  { mode: 'center', code: 'H', label: () => t('canvas.align.center') },
  { mode: 'right', code: 'D', label: () => t('canvas.align.right') },
  { mode: 'top', code: 'W', label: () => t('canvas.align.top') },
  { mode: 'middle', code: 'V', label: () => t('canvas.align.middle') },
  { mode: 'bottom', code: 'S', label: () => t('canvas.align.bottom') },
];
const DISTRIBUTES: readonly { axis: Axis; code: string; label: () => string }[] = [
  { axis: 'horizontal', code: 'H', label: () => t('canvas.distribute.horizontal') },
  { axis: 'vertical', code: 'V', label: () => t('canvas.distribute.vertical') },
];
const TIDIES: readonly { mode: TidyMode; label: () => string }[] = [
  { mode: 'row', label: () => t('canvas.tidy.row') },
  { mode: 'column', label: () => t('canvas.tidy.column') },
  { mode: 'grid', label: () => t('canvas.tidy.grid') },
];

export function CanvasMenu({ at, hasSelection, items, hasSection, canvasHeight, canPaste, mac, onCommand, onSelectContents, onClose }: CanvasMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  // Moved up by its own measured height when it would run off the bottom of the canvas.
  const [top, setTop] = useState(at.y);
  useLayoutEffect(() => {
    const height = panel.current?.offsetHeight ?? 0;
    setTop(Math.max(0, Math.min(at.y, canvasHeight - height)));
  }, [at.y, canvasHeight, items, hasSection]);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  const run = (command: CanvasCommand) => () => {
    onClose();
    onCommand(command);
  };
  const key = (letter: string, shift = false) => commandShortcut(letter, { shift, mac });
  const bracket = (open: boolean, shift: boolean) =>
    commandShortcut(open ? '[' : ']', { shift, mac });
  // The layout keys (5.3): Option on a Mac, Alt elsewhere.
  const alt = (letter: string, shift = false) => ({ label: mac ? `⌥${shift ? '⇧' : ''}${letter}` : `Alt+${shift ? 'Shift+' : ''}${letter}`, aria: `Alt+${shift ? 'Shift+' : ''}${letter}` });
  const section = { label: mac ? '⌘⌥G' : 'Ctrl+Alt+G', aria: mac ? 'Meta+Alt+G' : 'Control+Alt+G' };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape and focus leaving close the menu
    <div
      ref={panel}
      role="group"
      aria-label={t('canvas.menu')}
      style={{ left: at.x, top, maxHeight: canvasHeight }}
      className="absolute z-20 w-52 overflow-y-auto border border-text bg-surface"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onBlur={(event) => {
        // Focus gone out of the menu (Tab past its end) closes it, leaving focus where it went.
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <MenuGroup>
        <MenuItem shortcut={key('C')} disabled={!hasSelection} onClick={run({ kind: 'copy' })}>
          {t('canvas.copy')}
        </MenuItem>
        <MenuItem shortcut={key('X')} disabled={!hasSelection} onClick={run({ kind: 'cut' })}>
          {t('canvas.cut')}
        </MenuItem>
        <MenuItem shortcut={key('V')} disabled={!canPaste} onClick={run({ kind: 'paste', at: null })}>
          {t('canvas.paste')}
        </MenuItem>
        <MenuItem shortcut={key('D')} disabled={!hasSelection} onClick={run({ kind: 'duplicate' })}>
          {t('canvas.duplicate')}
        </MenuItem>
      </MenuGroup>
      <MenuGroup>
        <MenuItem shortcut={bracket(false, false)} disabled={!hasSelection} onClick={run({ kind: 'forward' })}>
          {t('canvas.forward')}
        </MenuItem>
        <MenuItem shortcut={bracket(true, false)} disabled={!hasSelection} onClick={run({ kind: 'backward' })}>
          {t('canvas.backward')}
        </MenuItem>
        <MenuItem shortcut={bracket(false, true)} disabled={!hasSelection} onClick={run({ kind: 'front' })}>
          {t('canvas.front')}
        </MenuItem>
        <MenuItem shortcut={bracket(true, true)} disabled={!hasSelection} onClick={run({ kind: 'back' })}>
          {t('canvas.back')}
        </MenuItem>
      </MenuGroup>
      <MenuGroup label={t('canvas.arrange')}>
        {ALIGNS.map(({ mode, code, label }) => (
          <MenuItem key={mode} shortcut={alt(code)} disabled={items < 2} onClick={run({ kind: 'align', mode })}>
            {label()}
          </MenuItem>
        ))}
        {DISTRIBUTES.map(({ axis, code, label }) => (
          <MenuItem key={axis} shortcut={alt(code, true)} disabled={items < 3} onClick={run({ kind: 'distribute', axis })}>
            {label()}
          </MenuItem>
        ))}
        {TIDIES.map(({ mode, label }) => (
          <MenuItem key={mode} {...(mode === 'grid' ? { shortcut: alt('T', true) } : {})} disabled={items < 2} onClick={run({ kind: 'tidy', mode })}>
            {label()}
          </MenuItem>
        ))}
        <MenuItem shortcut={section} disabled={items < 1} onClick={run({ kind: 'sectionAround' })}>
          {t('canvas.sectionAround')}
        </MenuItem>
        <MenuItem
          disabled={!hasSection}
          onClick={() => {
            onClose();
            onSelectContents();
          }}
        >
          {t('canvas.selectContents')}
        </MenuItem>
      </MenuGroup>
      <MenuGroup>
        <MenuItem hint="⌫" disabled={!hasSelection} onClick={run({ kind: 'delete' })}>
          {t('canvas.delete')}
        </MenuItem>
      </MenuGroup>
    </div>
  );
}
