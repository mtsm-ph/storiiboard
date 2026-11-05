// A confirm for what can't be undone asks in a window of the app's own (polish B), in the desktop app and the browser
// build alike, so the end-to-end tests answer the same window people see.
export { confirmForGood } from './ask';

/** "12.4 MB", "640 KB": a size people read at a glance. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
