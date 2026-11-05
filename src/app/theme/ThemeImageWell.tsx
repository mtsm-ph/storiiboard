import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { isTauriApp } from '../fileAccess';
import { showNotice } from '../notice';
import { choosePictures, fromFile, onWindowDrop, type PictureFile } from '../pictures';
import { t } from '../../core/i18n';

// Where a project's logo or key image goes (1.16): choose it, drop it or paste it, as frames take pictures (1.11). In
// the desktop app a drop comes through Rust with the point it landed on, and the well takes it when that point is
// inside; in the browser build the well's own drop events carry the file.

interface ThemeImageWellProps {
  /** The image shown, as a URL, or null before one is picked. */
  url: string | null;
  /** The theme names an image whose bytes are gone (deleted for good, 1.21): it says so, as a frame does. */
  missing?: boolean;
  name: string | null;
  onFiles: (files: PictureFile[]) => void;
  /** A modal (onboarding) takes any drop while it's open, wherever it lands. */
  takeAnyDrop?: boolean;
  /** While an image is being read, another isn't taken. */
  disabled?: boolean;
}

export function ThemeImageWell({ url, missing = false, name, onFiles, takeAnyDrop = false, disabled = false }: ThemeImageWellProps) {
  const well = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  // Read by the window listener registered once.
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (!isTauriApp) return;
    let stop: (() => void) | null = null;
    let live = true;
    void onWindowDrop((files, at) => {
      // What's on top at that point, so a well behind a modal (Settings → Theme under onboarding) never takes it too.
      const inside = well.current?.contains(document.elementFromPoint(at.x, at.y)) === true;
      if (files.length > 0 && (takeAnyDrop || inside)) latest.current(files);
    }).then((unlisten) => {
      if (live) stop = unlisten;
      else unlisten();
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [takeAnyDrop]);

  // The browser build's drops on the well, and a paste anywhere in the dialog or tile around it (the well itself
  // can't take focus); registered once, reading the latest handler.
  useEffect(() => {
    const element = well.current;
    if (!element) return;
    const around = element.closest<HTMLElement>('dialog, [data-theme-tile]') ?? element;
    const take = (list: FileList | null | undefined) => {
      const files = [...(list ?? [])].map(fromFile);
      if (files.length > 0) latest.current(files.slice(0, 1));
    };
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setOver(true);
    };
    const leave = () => {
      setOver(false);
    };
    const dropped = (event: DragEvent) => {
      event.preventDefault();
      // The board's own drop listener leaves drops inside a theme well alone.
      event.stopPropagation();
      setOver(false);
      take(event.dataTransfer?.files);
    };
    const pasted = (event: ClipboardEvent) => {
      if (!event.clipboardData?.files.length) return;
      event.preventDefault();
      take(event.clipboardData.files);
    };
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', dropped);
    // WebKit doesn't focus a clicked button, so after a click focus may be nowhere; it comes here instead, where a
    // paste reaches this listener rather than the board's.
    const clicked = () => {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && around.isConnected) around.focus({ preventScroll: true });
      });
    };
    around.addEventListener('paste', pasted);
    around.addEventListener('pointerdown', clicked);
    return () => {
      around.removeEventListener('pointerdown', clicked);
      element.removeEventListener('dragover', over);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', dropped);
      around.removeEventListener('paste', pasted);
    };
  }, []);

  return (
    <div className="flex flex-col gap-[5px]">
      <span className="sb-label">{t('themeImageWell.logoOrKeyImage')}</span>
      <div
        ref={well}
        data-theme-well=""
        className={cx(
          'flex min-h-[96px] items-center gap-3 border border-dashed border-text p-2',
          over && 'outline-2 -outline-offset-4 outline-text outline-dashed',
        )}
      >
        {url ? (
          <img src={url} alt="" className="block max-h-[80px] max-w-[160px] object-contain" />
        ) : (
          <span className="sb-label text-text-muted">{missing ? t('frameImage.pictureMissing') : t('storyboardView.noImage')}</span>
        )}
        <span className="flex flex-col gap-1">
          {name && <span className="truncate font-mono text-[11px] text-text-muted">{name}</span>}
          <Button
            disabled={disabled}
            onClick={() => {
              choosePictures(false)
                .then((files) => {
                  if (files.length > 0) onFiles(files);
                })
                .catch(showNotice);
            }}
          >
            {url ? t('themeImageWell.replaceImage') : t('themeImageWell.chooseImage')}
          </Button>
          <span className="text-[12px] text-text-muted">{t('themeImageWell.orDropOrPasteOne')}</span>
        </span>
      </div>
    </div>
  );
}
