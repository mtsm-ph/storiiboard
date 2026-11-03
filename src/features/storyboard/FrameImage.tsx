import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cropBox, type Crop } from '../../core/media/crop';
import type { ImageSize } from '../../core/media/urls';

// A frame's picture, cropped to the project's aspect ratio as the shot says. Cards draw the 640px thumbnail and only
// once they come near the screen, so a 1000-frame board reads only the pictures it shows; the crop is CSS on a plain
// <img>, never a canvas.

/** Turns a stored picture into a URL to draw. The tile that draws frames provides it from the open project. */
export type PictureUrl = (sha256: string, size: ImageSize) => Promise<string | null>;

export const PictureUrls = createContext<PictureUrl>(() => Promise.resolve(null));

/** What a view needs to draw a frame's picture: no bytes, only its address and shape. */
export interface FramePictureView {
  sha256: string;
  /** Width over height. */
  aspect: number;
  crop: Crop;
}

interface FrameImageProps {
  picture: FramePictureView;
  frameAspect: number;
  size?: ImageSize;
  /** Draws at once, rather than when it comes near the screen. */
  eager?: boolean;
}

/**
 * Fills its parent, which gives the frame its shape. The picture itself is silent to screen readers (the frame is
 * named by its number); a missing one is announced.
 */
export function FrameImage({ picture, frameAspect, size = 'thumbnail', eager = false }: FrameImageProps) {
  const urlFor = useContext(PictureUrls);
  const holder = useRef<HTMLSpanElement>(null);
  // Without IntersectionObserver (an old webview), every picture draws at once.
  const [near, setNear] = useState(() => eager || typeof IntersectionObserver === 'undefined');
  // Undefined while it loads; null when the file doesn't hold the picture.
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const element = holder.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let current = true;
    urlFor(picture.sha256, size).then(
      (next) => {
        if (current) setUrl(next);
      },
      () => {
        if (current) setUrl(null);
      },
    );
    return () => {
      current = false;
    };
  }, [near, picture.sha256, size, urlFor]);

  const box = cropBox(picture.crop, picture.aspect, frameAspect);
  return (
    <span ref={holder} className="absolute inset-0 overflow-hidden">
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          data-frame-image=""
          className="absolute max-w-none select-none"
          style={{ left: `${String(box.left)}%`, top: `${String(box.top)}%`, width: `${String(box.width)}%`, height: `${String(box.height)}%` }}
        />
      )}
      {url === null && (
        // Missing media is flagged plainly (CLAUDE.md). Relinking arrives with linked files in Phase 2.
        <span className="sb-label absolute inset-0 flex items-center justify-center text-warning dark:text-text">
          Picture missing
        </span>
      )}
    </span>
  );
}
