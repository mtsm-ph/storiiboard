// A canvas to draw on away from the page, for the picture pipeline (image.ts) and exports (src/features/export).
// OffscreenCanvas where the webview has it; a detached <canvas> where it doesn't: WKWebView before Safari 16.4, which
// is macOS 13.0 to 13.2, a system the app still supports (tauri.conf.json, minimumSystemVersion).

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

/** The canvas encoded as `type`; null when the webview couldn't encode it. */
export async function canvasBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}
