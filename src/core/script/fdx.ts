import { characterName, eighthsFromLength, eighthsFromLines, parseHeading, printedLines, type Script, type ScriptScene } from './script';
import { t } from '../i18n';

// Final Draft (.fdx), an XML file of typed paragraphs: Scene Heading, Action, Character, Dialogue and so on, with each
// scene's number and length on the heading. Read with a small tag scanner rather than DOMParser, so it runs the same in
// the app, the MCP server and the tests; only the <Content> paragraphs are read (title page, headers and settings
// aren't the script).

interface Paragraph {
  type: string;
  number: string | null;
  /** SceneProperties' Length on a heading, as Final Draft writes it: `1 3/8`. */
  length: string | null;
  text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    // A number past Unicode is left as written rather than stopping the import.
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attributes);
  const value = match?.[2] ?? match?.[3];
  return value === undefined ? null : decode(value);
}

/**
 * The paragraphs inside <Content> (the script's, or with `titlePage` the title page's), in order; a dual-dialogue
 * block's paragraphs come out one by one.
 */
function paragraphs(xml: string, titlePage = false): Paragraph[] {
  const out: Paragraph[] = [];
  const open: Paragraph[] = [];
  let inContent = false;
  // The title page has a <Content> of its own, which isn't the script.
  let inTitlePage = false;
  let inText = 0;
  // A tag's attributes may hold a quoted > (`Title="A > B"`).
  const tags = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
  for (const match of xml.matchAll(tags)) {
    const [, closing, name, attributes = '', selfClosing, text, cdata] = match;
    const paragraph = open.at(-1);
    if (text !== undefined || cdata !== undefined) {
      if (paragraph && inText > 0) paragraph.text += cdata ?? decode(text ?? '');
      continue;
    }
    if (name === 'TitlePage') {
      inTitlePage = closing !== '/' && selfClosing !== '/';
      continue;
    }
    if (name === 'Content' && inTitlePage === titlePage) {
      inContent = closing !== '/' && selfClosing !== '/';
      continue;
    }
    if (!inContent || name === undefined) continue;
    if (name === 'Paragraph') {
      if (closing === '/') {
        const done = open.pop();
        if (done) out.push(done);
      } else if (selfClosing !== '/') {
        open.push({ type: attribute(attributes, 'Type') ?? '', number: attribute(attributes, 'Number'), length: null, text: '' });
      }
    } else if (name === 'SceneProperties' && paragraph && closing !== '/') {
      paragraph.length = attribute(attributes, 'Length');
    } else if (name === 'Text' && selfClosing !== '/') {
      inText += closing === '/' ? -1 : 1;
    }
  }
  // A paragraph that only holds a dual-dialogue block closes after the ones inside it, with no text of its own.
  return out.filter((p) => p.type !== '' || p.text.trim() !== '');
}

/** Print widths in characters for Courier 12, as in fountain.ts. */
const WIDTH: Readonly<Record<string, number>> = { Action: 61, Dialogue: 35, Parenthetical: 25 };

/** A Final Draft script's scenes, in order. */
export function parseFdx(xml: string): Script {
  if (!/<FinalDraft\b/.test(xml)) throw new Error(t('script.notFdx'));
  const scenes: ScriptScene[] = [];
  let current: (ScriptScene & { lines: number; length: number | null }) | null = null;
  const close = () => {
    if (!current) return;
    const { lines, length, ...scene } = current;
    scenes.push({ ...scene, eighths: length ?? eighthsFromLines(lines) });
  };
  for (const paragraph of paragraphs(xml)) {
    const text = paragraph.text.replace(/\s+/g, ' ').trim();
    if (paragraph.type === 'Scene Heading') {
      // An empty heading paragraph is a slip in the file, not a scene.
      if (text === '') continue;
      close();
      current = {
        ...parseHeading(text),
        number: paragraph.number?.trim() || null,
        characters: [],
        eighths: 1,
        lines: 2,
        length: paragraph.length ? eighthsFromLength(paragraph.length) : null,
      };
      continue;
    }
    if (!current) continue;
    if (paragraph.type === 'Character') {
      const name = characterName(text);
      if (name !== '' && !current.characters.includes(name)) current.characters.push(name);
      current.lines += 2;
    } else {
      current.lines += printedLines(text, WIDTH[paragraph.type] ?? 61) + (paragraph.type === 'Action' ? 1 : 0);
    }
  }
  close();
  // The title page's first line with text on it, all its runs together.
  const title = paragraphs(xml, true)
    .map((p) => p.text.replace(/\s+/g, ' ').trim())
    .find((line) => line !== '');
  return { title: title ?? null, scenes };
}
