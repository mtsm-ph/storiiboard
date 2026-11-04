import { sceneLabel } from '../../core/model/storyboard';

// Export file names (1.24, decided Nov 2): a frame is `SC004_4A.png`, its scene and shot numbers exactly as on the
// slate, so an editor can match them. The scene's digits are padded to three so plain scene numbers line up in a
// folder (SC004 before SC012); a name sort is not board order, though: 12A files before 12, A4 after 4, and 4AA
// before 4B, as letters sort. The board order is the export's own order. Characters a file system refuses are left
// out of names that come from titles.

/** A scene number with its digits padded to three: `4` → `004`, `12A` → `012A`, `A4` → `A004`. */
export function paddedScene(number: string): string {
  return number.replace(/\d+/, (digits) => digits.padStart(3, '0'));
}

export function frameFileName(sceneNumber: string, shotNumber: string, extension = 'png'): string {
  return `SC${paddedScene(sceneNumber)}_${shotNumber}.${extension}`;
}

/**
 * Names for a set of files, each one new: a name already given (whatever its case, as Windows and macOS compare
 * them) gets ` (2)`, ` (3)`… before its extension. An old file can hold two live scenes with one number, and the
 * export would otherwise stop halfway at the second `SC004_4A.png`.
 */
export function uniqueNames(): (name: string) => string {
  const given = new Set<string>();
  return (name) => {
    const dot = name.lastIndexOf('.');
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let n = 2; given.has(candidate.toLowerCase()); n += 1) candidate = `${stem} (${String(n)})${extension}`;
    given.add(candidate.toLowerCase());
    return candidate;
  };
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
