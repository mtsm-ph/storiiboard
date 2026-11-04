import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { isTauriApp } from '../fileAccess';
import { showNotice } from '../notice';
import { choosePictures, fromFile, onWindowDrop, type PictureFile } from '../pictures';

// Where a project's logo or key image goes (1.16): choose it, drop it or paste it, as frames take pictures (1.11). In
// the desktop app a drop comes through Rust with the point it landed on, and the well takes it when that point is
// inside; in the browser build the well's own drop events carry the file.

interface ThemeImageWellProps {
  /** The image shown, as a URL, or null before one is picked. */
  url: string | null;
  name: string | null;
  onFiles: (files: PictureFile[]) => void;
  /** A modal (onboarding) takes any drop while it's open, wherever it lands. */
  takeAnyDrop?: boolean;
}

export function ThemeImageWell({ url, name, onFiles, takeAnyDrop = false }: ThemeImageWellProps) {
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
      const box = well.current?.getBoundingClientRect();
      const inside = box && at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom;
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

  // The browser build's drops and any paste, on the well itself; registered once, reading the latest handler.
  useEffect(() => {
    const element = well.current;
    if (!element) return;
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
    element.addEventListener('paste', pasted);
    return () => {
      element.removeEventListener('dragover', over);
      element.removeEventListener('dragleave', leave);
      element.removeEventListener('drop', dropped);
      element.removeEventListener('paste', pasted);
    };
  }, []);

  return (
    <div className="flex flex-col gap-[5px]">
      <span className="sb-label">Logo or key image</span>
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
          <span className="sb-label text-text-muted">No image</span>
        )}
        <span className="flex flex-col gap-1">
          {name && <span className="truncate font-mono text-[11px] text-text-muted">{name}</span>}
          <Button
            onClick={() => {
              choosePictures(false)
                .then((files) => {
                  if (files.length > 0) onFiles(files);
                })
                .catch(showNotice);
            }}
          >
            {url ? 'Replace image…' : 'Choose image…'}
          </Button>
          <span className="text-[12px] text-text-muted">Or drop or paste one here.</span>
        </span>
      </div>
    </div>
  );
}
