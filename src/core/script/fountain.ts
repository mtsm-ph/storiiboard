import { characterName, eighthsFromLines, looksLikeHeading, parseHeading, printedLines, type Script, type ScriptScene } from './script';

// Fountain (fountain.io), the plain-text screenplay format, read by its rules: scene headings, character cues and
// dialogue, with the title page, notes ([[ ]]) and the boneyard (/* */) left out. Only what an import needs is kept.

type Element =
  | { kind: 'heading'; text: string; number: string | null }
  | { kind: 'character'; name: string }
  | { kind: 'dialogue' | 'parenthetical' | 'action' | 'transition'; text: string };

/** Print widths in characters for Courier 12 on a standard page, by element. */
const WIDTH = { action: 61, dialogue: 35, parenthetical: 25 } as const;

/** The title page: `Key: value` lines at the very top, up to the first blank line. */
function splitTitlePage(text: string): { title: string | null; body: string } {
  const lines = text.split('\n');
  if (!/^\s*[A-Za-z][A-Za-z ]*:/.test(lines[0] ?? '')) return { title: null, body: text };
  const end = lines.findIndex((line) => line.trim() === '');
  const page = lines.slice(0, end === -1 ? lines.length : end);
  // A key's value is on its line or on the indented lines after it.
  const at = page.findIndex((line) => /^\s*title\s*:/i.test(line));
  const parts: string[] = [];
  if (at !== -1) {
    parts.push(page[at]?.replace(/^\s*title\s*:/i, '').trim() ?? '');
    for (const line of page.slice(at + 1)) {
      if (!/^(\s{3,}|\t)/.test(line)) break;
      parts.push(line.trim());
    }
  }
  // Emphasis marks (*, _) aren't part of the title.
  const title = parts.filter((part) => part !== '').join(' ').replace(/[*_]/g, '');
  return { title: title === '' ? null : title, body: end === -1 ? '' : lines.slice(end + 1).join('\n') };
}

/** A heading's scene number, written at its end between #s: `INT. HOUSE - DAY #4A#`. */
function headingNumber(line: string): { text: string; number: string | null } {
  const match = /\s*#([^#\s][^#]*)#\s*$/.exec(line);
  if (!match) return { text: line, number: null };
  return { text: line.slice(0, match.index), number: match[1]?.trim() ?? null };
}

const isUpperCue = (line: string) => {
  // The cue without its extension, which may be lowercase: MARY (cont'd).
  const bare = line.replace(/\([^)]*\)/g, '').replace(/\^\s*$/, '').trim();
  return /[A-Z]/.test(bare) && bare === bare.toUpperCase() && !/^[\d\W]+$/.test(bare);
};

function elements(body: string): Element[] {
  const lines = body.split('\n');
  const out: Element[] = [];
  let inDialogue = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    const before = i === 0 || (lines[i - 1] ?? '').trim() === '';
    const after = (lines[i + 1] ?? '').trim();
    if (line === '') {
      inDialogue = false;
      continue;
    }
    if (inDialogue) {
      out.push(/^\(.*\)$/.test(line) ? { kind: 'parenthetical', text: line } : { kind: 'dialogue', text: line });
      continue;
    }
    // Sections (#), synopses (=), page breaks (===), lyrics (~) and centred text (> <) aren't scenes or speech.
    if (/^(#|=|~)/.test(line) || /^>.*<$/.test(line)) continue;
    if (line.startsWith('!')) {
      out.push({ kind: 'action', text: line.slice(1) });
      continue;
    }
    const forcedHeading = /^\.[^.]/.test(line);
    if (before && (forcedHeading || (looksLikeHeading(line) && after === ''))) {
      const { text, number } = headingNumber(forcedHeading ? line.slice(1) : line);
      out.push({ kind: 'heading', text: text.trim(), number });
      continue;
    }
    if (line.startsWith('>') || (before && after === '' && /^[A-Z\s.]+TO:$/.test(line))) {
      out.push({ kind: 'transition', text: line.replace(/^>/, '').trim() });
      continue;
    }
    const forcedCue = line.startsWith('@');
    if (before && after !== '' && (forcedCue || isUpperCue(line))) {
      const name = characterName(forcedCue ? line.slice(1) : line);
      if (name !== '') {
        out.push({ kind: 'character', name });
        inDialogue = true;
        continue;
      }
    }
    out.push({ kind: 'action', text: line });
  }
  return out;
}

/** How many printed lines an element takes, with the blank line before the ones that have one. */
function lineCount(element: Element): number {
  switch (element.kind) {
    case 'heading':
      return 2;
    case 'character':
      return 2;
    case 'transition':
      return 2;
    case 'parenthetical':
      return printedLines(element.text, WIDTH.parenthetical);
    case 'dialogue':
      return printedLines(element.text, WIDTH.dialogue);
    case 'action':
      return printedLines(element.text, WIDTH.action) + 1;
  }
}

/** A Fountain script's scenes, in order. Text before the first heading belongs to no scene. */
export function parseFountain(source: string): Script {
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // The boneyard and notes are never part of the script.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[\[[\s\S]*?\]\]/g, '');
  const { title, body } = splitTitlePage(text);
  const scenes: ScriptScene[] = [];
  let current: (ScriptScene & { lines: number }) | null = null;
  const close = () => {
    if (!current) return;
    const { lines, ...scene } = current;
    scenes.push({ ...scene, eighths: eighthsFromLines(lines) });
  };
  for (const element of elements(body)) {
    if (element.kind === 'heading') {
      close();
      current = { ...parseHeading(element.text), number: element.number, characters: [], eighths: 1, lines: 0 };
    }
    if (!current) continue;
    current.lines += lineCount(element);
    if (element.kind === 'character' && !current.characters.includes(element.name)) current.characters.push(element.name);
  }
  close();
  return { title, scenes };
}
