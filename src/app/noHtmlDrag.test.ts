import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import OS_DROP_FILES from './osDropFiles.json';

// No HTML5 drag and drop in the app (6.15, docs/DESKTOP_GAPS.md B1): the desktop window keeps Tauri's file drop on, and
// on Windows that turns HTML5 drag and drop off inside the page. eslint.config.js's rule sees the plain shapes; this
// reads src as text, so the ones a selector can't see fail too (6.15 review): props spread from an object or a hook, a
// component that forwards `draggable` to a DOM node, createElement, a template literal or a variable for the event's
// name, `el['draggable']`, toggleAttribute, Object.assign. Every file that mentions drag and drop is listed with why.

const root = join(import.meta.dirname, '../..');

const MESSAGE =
  'HTML5 drag and drop is off inside the Windows app (Tauri’s file drop): use pointer events (src/ui/useRowDrag.ts). ' +
  'Konva’s own dragging goes in KONVA_FILES with its reason; files dropped from the system are taken in the browser ' +
  'build only, in a file src/app/osDropFiles.json lists beside its Tauri path (eslint.config.js reads the same list).';

/** Files whose drag words are react-konva's own dragging: pointer events inside Konva, never HTML5. */
const KONVA_FILES: Readonly<Record<string, string>> = {
  'src/features/locations/LocationMap.tsx': 'the map’s pin and its drag to pan: react-konva’s draggable, onDragStart and onDragEnd',
};

/** What counts as a mention: any of the drag words, but not the browser's own image drag turned off. */
const MENTIONS = [
  /\bdraggable\b(?!\s*(?:=\s*\{\s*false\s*\}|:\s*false\b))/g,
  /\bonDragStart\b/g,
  /\bonDragEnd\b/g,
  /\bonDrag\b/g,
  /dragstart/g,
  /dragend/g,
  /setDragImage/g,
  /dataTransfer/g,
];
/** Words only an HTML5 drag that starts in the page uses: never in a file that only receives the system's drops. */
const STARTS = [/\bdraggable\b(?!\s*(?:=\s*\{\s*false\s*\}|:\s*false\b))/, /\bonDragStart\b/, /\bonDragEnd\b/, /\bonDrag\b/, /dragstart/, /dragend/, /setDragImage/];
/**
 * A file receiving the system's drops reads dataTransfer only as files, items and types, or sets its dropEffect; a test
 * `if (event.dataTransfer)` is fine. Anything else keeps or passes it on (`dt = event.dataTransfer`,
 * `take(event.dataTransfer)`, `event['dataTransfer']`).
 */
const TRANSFER_READ = /^dataTransfer\s*(?:\?\.|!?\.)\s*(?:files|items|types|dropEffect)\b/;
const TRANSFER_TESTED = { before: /\bif\s*\(\s*[\w$]+\??\.$/, after: /^dataTransfer\s*\)/ };
const transferRead = (text: string, at: number) => {
  const after = text.slice(at, at + 40);
  return TRANSFER_READ.test(after) || (TRANSFER_TESTED.before.test(text.slice(Math.max(0, at - 40), at)) && TRANSFER_TESTED.after.test(after));
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const texts = () =>
  Object.fromEntries(sourceFiles(join(root, 'src')).map((path) => [relative(root, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')] as const));

describe('HTML5 drag and drop in the app’s code (6.15)', () => {
  it('is mentioned only in the files listed, each with its reason', () => {
    const found = Object.entries(texts())
      .filter(([, text]) => MENTIONS.some((word) => text.match(word) !== null))
      .map(([file]) => file);
    const listed = [...Object.keys(KONVA_FILES), ...Object.keys(OS_DROP_FILES)];
    expect(found.filter((file) => !listed.includes(file)), MESSAGE).toEqual([]);
    // A file taken off the list once its drag words are gone, so the list stays what is in the code.
    expect(listed.filter((file) => !found.includes(file)), 'Listed but no longer mentions drag and drop: take it off the list').toEqual([]);
  });

  it('is Konva’s own in the Konva files: react-konva, and none of HTML5’s own words', () => {
    const all = texts();
    for (const file of Object.keys(KONVA_FILES)) {
      const text = all[file] ?? '';
      expect(text, `${file} draws with react-konva`).toMatch(/from 'react-konva'/);
      expect(/dataTransfer|setDragImage|dragstart|dragend/.test(text), `${file}: ${MESSAGE}`).toBe(false);
    }
  });

  it('only receives the system’s drops in the OS-drop files, and reads dataTransfer without keeping or passing it on', () => {
    const all = texts();
    for (const file of Object.keys(OS_DROP_FILES)) {
      const text = all[file] ?? '';
      expect(
        STARTS.filter((word) => word.test(text)).map(String),
        `${file} receives drops only: ${MESSAGE}`,
      ).toEqual([]);
      const uses = [...text.matchAll(/dataTransfer/g)].filter((match) => !transferRead(text, match.index)).map((match) => text.slice(Math.max(0, match.index - 20), match.index + 30));
      expect(
        uses,
        `${file}: dataTransfer is read as files, items or types (or its dropEffect set), never kept or passed on`,
      ).toEqual([]);
    }
  });

  it('keeps one list of the OS-drop files: the one eslint.config.js reads', () => {
    const config = readFileSync(join(root, 'eslint.config.js'), 'utf8');
    expect(config).toMatch(/import OS_DROP_FILES from '\.\/src\/app\/osDropFiles\.json'/);
    expect(config).not.toMatch(/const OS_DROP_FILES\s*=/);
    for (const reason of Object.values(OS_DROP_FILES)) expect(reason.trim()).not.toBe('');
  });
});
