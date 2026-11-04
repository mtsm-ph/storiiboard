import { sceneLabel } from '../../core/model/storyboard';

// Export file names (1.24, decided Nov 2): a frame is `SC004_4A.png`, its scene number padded so files sort in
// scene order and its shot number exactly as on the slate, so an editor can match them. Characters a file system
// refuses are left out of names that come from titles.

/** A scene number with its digits padded to three: `4` → `004`, `12A` → `012A`, `A4` → `A004`. */
export function paddedScene(number: string): string {
  return number.replace(/\d+/, (digits) => digits.padStart(3, '0'));
}

export function frameFileName(sceneNumber: string, shotNumber: string, extension = 'png'): string {
  return `SC${paddedScene(sceneNumber)}_${shotNumber}.${extension}`;
}

/** A project or scene title as part of a file name: no slashes, colons or the like. */
export function safeName(text: string): string {
  // Control characters too: never part of a name a person typed on purpose.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return text.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Storiiboard';
}

/** `Bey County shot list.csv`, `Bey County SC 04 shot list.csv`. */
export function exportName(project: string, scene: string | null, what: string, extension?: string): string {
  const base = safeName([project, scene === null ? null : sceneLabel(scene), what].filter((part) => part !== null).join(' '));
  return extension ? `${base}.${extension}` : base;
}
