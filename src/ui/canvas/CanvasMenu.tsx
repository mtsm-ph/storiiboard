import { useEffect, useRef } from 'react';
import { t } from '../../core/i18n';
import { commandShortcut, MenuGroup, MenuItem } from '../Menu';
import type { CanvasCommand, Point } from './types';

// The right-click menu (decision 11), also opened by Shift+F10 or the menu key: Copy, Cut, Paste, Duplicate, Delete and
// the four z-order moves. A panel of buttons like the app's other menus (src/ui/Menu.tsx); Escape closes it and
// focus goes back to the canvas.

interface CanvasMenuProps {
  /** Where it opens, in pixels from the canvas's top left. */
  at: Point;
  hasSelection: boolean;
  canPaste: boolean;
  mac: boolean;
  onCommand: (command: CanvasCommand) => void;
  onClose: () => void;
}

export function CanvasMenu({ at, hasSelection, canPaste, mac, onCommand, onClose }: CanvasMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
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

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape and focus leaving close the menu
    <div
      ref={panel}
      role="group"
      aria-label={t('canvas.menu')}
      style={{ left: at.x, top: at.y }}
      className="absolute z-20 w-52 border border-text bg-surface"
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
      <MenuGroup>
        <MenuItem hint="⌫" disabled={!hasSelection} onClick={run({ kind: 'delete' })}>
          {t('canvas.delete')}
        </MenuItem>
      </MenuGroup>
    </div>
  );
}
