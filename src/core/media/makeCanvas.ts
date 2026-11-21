// A canvas to draw on away from the page: OffscreenCanvas where the webview has it; a detached <canvas> where it
// doesn't: WKWebView before Safari 16.4, which is macOS 13.0 to 13.2, a system the app still supports (tauri.conf.json,
// minimumSystemVersion). A module with no imports, so the accent reader's worker (src/ui/theme/generator/sample.ts)
// can use it without pulling the translations or the picture cleaner into its bundle; canvas.ts re-exports it for the
// page. In a worker with neither OffscreenCanvas nor a document there is no canvas to make, and it throws.

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** A canvas `width` by `height` and its 2D context, or a null context when the webview can't give one. */
export function makeCanvas(
  width: number,
  height: number,
  settings?: CanvasRenderingContext2DSettings,
): { canvas: AnyCanvas; ctx: Canvas2D | null } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, ctx: canvas.getContext('2d', settings) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', settings) };
}
