import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, labels, list, LOCALES, localizeError, setLocale, t, tn, type MessageKey } from '.';
import { en } from './locales/en';

const root = join(import.meta.dirname, '../../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$|\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => {
  setLocale('en');
});

describe('t and tn', () => {
  it('fill placeholders and leave a missing one as written', () => {
    expect(t('dock.resize', { first: 'Scenes', second: 'Storyboard' })).toBe('Resize Scenes and Storyboard');
    expect(t('dock.resize', { first: 'Scenes' })).toBe('Resize Scenes and {second}');
  });

  it('write numbers as they are: no grouping, no locale decimals', () => {
    expect(t('history.lens', { mm: 1200 })).toBe('1200mm');
    expect(t('history.tStop', { stop: 2.8 })).toBe('T2.8');
  });

  it('pick the plural form by the language’s rules', () => {
    expect(tn('count.frames', 1)).toBe('1 frame');
    expect(tn('count.frames', 0)).toBe('0 frames');
    expect(tn('count.frames', 12)).toBe('12 frames');
    expect(tn('history.items', 1)).toBe('an item');
  });

  it('reads tables of labels in the current language each time', () => {
    const table = labels({ a: 'shotStatus.have', b: 'shotStatus.need' });
    expect(table.a).toBe('Have');
    expect(Object.keys(table)).toEqual(['a', 'b']);
    expect({ ...table }).toEqual({ a: 'Have', b: 'Need to shoot' });
  });

  it('joins a list the way the language does', () => {
    expect(list(['4C is now 4E'])).toBe('4C is now 4E');
    expect(list(['4C is now 4E', '4D is now 4F'])).toBe('4C is now 4E and 4D is now 4F');
    expect(list(['4C is now 4E', '4D is now 4F', '4G is now 4H'])).toBe('4C is now 4E, 4D is now 4F and 4G is now 4H');
  });

  it('keeps English when asked for a language it doesn’t have', () => {
    setLocale('xx' as never);
    expect(getLocale()).toBe('en');
  });
});

describe('the English file', () => {
  const keys = Object.keys(en) as MessageKey[];

  it('has both forms of every counted phrase, the plural one holding {count}', () => {
    for (const key of keys.filter((k) => k.endsWith('.one') || k.endsWith('.other'))) {
      const base = key.replace(/\.(one|other)$/, '');
      expect(keys, `${base} needs .one and .other`).toContain(`${base}.one`);
      expect(keys, `${base} needs .one and .other`).toContain(`${base}.other`);
      // The singular may say it in words ("an item"); the plural always shows the number.
      if (key.endsWith('.other')) expect(en[key], key).toContain('{count}');
    }
  });

  it('is the shape every translation follows: same keys, same placeholders', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(locale.messages).sort(), locale.id).toEqual([...keys].sort());
      for (const key of keys) expect(placeholders(locale.messages[key]), `${locale.id} ${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('holds no key the code no longer uses', () => {
    const code = sourceFiles(join(root, 'src'))
      .filter((path) => !path.includes(join('i18n', 'locales')))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    // Keys the code builds from an id: a tile's title, a drop zone, a status count, a field's error.
    const built = [/^tile\.\w+\.(title|note)$/, /^dock\.zone\./, /^dock\.edge\./, /^board\.counts\./, /^error\./];
    const unused = keys.filter((key) => {
      if (built.some((pattern) => pattern.test(key))) return false;
      const literal = key.replace(/\.(one|other)$/, '');
      return ![`'${literal}'`, `'${key}'`, `"${key}"`].some((quoted) => code.includes(quoted));
    });
    expect(unused).toEqual([]);
  });
});

describe('Spanish (polish 7)', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('reads right whatever the count, in sentences built round a counted phrase', () => {
    setLocale('es');
    const at = (n: number) => [
      t('trash.emptyConfirm', { what: tn('count.items', n) }),
      t('export.done', { what: tn('count.frames', n), label: 'Escritorio' }),
      t('scene.deleted', { scene: 'ESC 04', what: tn('count.frames', n), undo: 'Ctrl+Z' }),
      t('history.erasedOn', { strokes: tn('count.strokes', n), frame: '4A' }),
      t('script.imported', { scenes: tn('count.scenes', n), name: 'guion.fountain', undo: 'Ctrl+Z' }),
    ];
    expect(at(1)).toEqual([
      'Esto borra para siempre 1 elemento, con sus bocetos e imágenes.',
      'Exportación lista en “Escritorio”: 1 cuadro.',
      'Se envió ESC 04 a la Papelera, junto con 1 cuadro. Ctrl+Z deshace el borrado.',
      'Borrado en 4A: 1 trazo',
      'Importado de “guion.fountain”: 1 escena. Ctrl+Z deshace la importación.',
    ]);
    expect(at(3)).toEqual([
      'Esto borra para siempre 3 elementos, con sus bocetos e imágenes.',
      'Exportación lista en “Escritorio”: 3 cuadros.',
      'Se envió ESC 04 a la Papelera, junto con 3 cuadros. Ctrl+Z deshace el borrado.',
      'Borrado en 4A: 3 trazos',
      'Importado de “guion.fountain”: 3 escenas. Ctrl+Z deshace la importación.',
    ]);
    expect(list(['ESC 01', 'ESC 02', 'ESC 03'])).toBe('ESC 01, ESC 02 y ESC 03');
  });
});

describe('errors raised below the UI', () => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const errorEntries = Object.entries(en)
    .filter(([key]) => key.startsWith('error.'))
    .map(([, text]) => new RegExp(`^${text.split(/\{\w+\}/).map(escape).join('.+?')}$`, 's'));

  it('read in the app’s language, and pass through when no translation has them', () => {
    expect(localizeError("There's no project file at that path.")).toBe("There's no project file at that path.");
    expect(localizeError('A backup named "Bey County 2026-11-04 18-30.sbd" already exists.')).toBe(
      'A backup named "Bey County 2026-11-04 18-30.sbd" already exists.',
    );
    expect(localizeError('Access is denied. (os error 5)')).toBe('Access is denied. (os error 5)');
  });

  it('cover every message the Rust commands send', () => {
    const messages = readdirSync(join(root, 'src-tauri', 'src'))
      .filter((name) => name.endsWith('.rs'))
      .flatMap((name) => {
        const text = readFileSync(join(root, 'src-tauri', 'src', name), 'utf8');
        // Each file's test module comes last; its strings are fixtures, not messages.
        const code = text.split(/^#\[cfg\(test\)\]\r?\nmod tests/m)[0] ?? '';
        // Err("…"), format!("…"), ok_or("…") and "…".to_string() or .into(), which rustfmt may put on the next line; a
        // format's {…} reads as X;
        // and const NAME: &str = "…" (rustfmt may put the value on the next line), which most messages are.
        const found = code.matchAll(/(?:Err\(|format!\(|ok_or\()\s*"((?:[^"\\]|\\.)*)"|"((?:[^"\\]|\\.)*)"\s*\.(?:to_string|into)\(\)|const \w+: &str =\s*"((?:[^"\\]|\\.)*)"/g);
        return [...found].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\"/g, '"').replace(/\{[^}]*\}/g, 'X'));
      })
      // Messages for people end a sentence; SQL, paths and names don't.
      .filter((m) => /^[A-Z"X].*\s.*[.]$/.test(m) && !/^(SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE)\b/.test(m));
    const internal = new Set([
      // A bug in the app, never something a person did: shown as they are.
      'Expected the export as raw bytes.',
      'Expected the transaction as raw bytes.',
      'Pass objects and arrays as JSON text.',
      "That column doesn't hold bytes.",
      "A query can't return bytes; read them with readBlob.",
      "The export's bytes are malformed.",
      "The transaction's bytes are malformed.",
      "A stored number isn't finite.",
      "Stored text isn't valid UTF-8.",
      "The backups folder's path isn't valid text.",
      "The projects folder's path isn't valid text.",
      "The copy's path isn't valid text.",
      "The copy isn't open.",
      "X doesn't fit in a SQLite number.",
      '"X" isn\'t an app data file.',
      'The backup copy has already ended.',
      "Couldn't set the project's journal mode (got X).",
      // Why a picture's original file wasn't read for a deck's PDF (src-tauri/src/originals.rs): the page catches each and prints the
      // copy kept in the project, which the export's notice says. They are never shown as they are.
      "That picture's path isn't a plain file path.",
      "That picture's path is on a network share the project isn't on.",
      "That picture's path leaves the project's folder.",
      "That picture's path goes through a link.",
      "That picture can't be looked at.",
      "That isn't a picture's hash.",
      "That isn't a plain file.",
      'That picture is too large to print from its original.',
      "That file isn't a picture.",
      // Show in Finder / Explorer (src-tauri/src/open.rs): the page catches it and says the same in the app's language
      // (moodboard.originalGone).
      "That picture's original isn't where it was.",
      // A service id the code doesn't list: a bug in the app, never something a person did.
      "Storiiboard doesn't know that service.",
    ]);
    const missing = [...new Set(messages)].filter((m) => !internal.has(m) && !errorEntries.some((pattern) => pattern.test(m)));
    expect(missing).toEqual([]);
    // The scan still finds them: a change to how they're written mustn't quietly check nothing.
    expect(messages.length).toBeGreaterThan(25);
  });

  it('cover every message the TypeScript drivers and ops raise, which stand in for Rust', () => {
    const files = ['core/storage/memoryDriver.ts', 'core/storage/nodeDriver.ts', 'core/storage/driver.ts', 'core/storage/migrate.ts', 'core/storage/backups.ts', 'core/storage/openBackup.ts', 'core/ops/ops.ts', 'core/media/image.ts'];
    const internal = /^(Unknown record type|Unexpected value in column)/;
    let checked = 0;
    for (const file of files) {
      const text = readFileSync(join(root, 'src', file), 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const found: string[] = [];
      const visit = (node: ts.Node) => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && /^[A-Z“"T]/.test(node.getText().slice(1))) {
          const said = ts.isTemplateExpression(node)
            ? [node.head.text, ...node.templateSpans.map((s) => `X${s.literal.text}`)].join('')
            : node.text;
          if (/[.]$/.test(said) && /\s/.test(said) && !/^(SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE|WITH)\b/.test(said)) found.push(said);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const said of found) {
        if (internal.test(said)) continue;
        // A template's ${…} parts read as X: the message must match an error.* entry with a placeholder there.
        expect(errorEntries.some((pattern) => pattern.test(said)), `${file}: ${said}`).toBe(true);
        checked += 1;
      }
    }
    // The scan itself still finds them: a change to how they're written mustn't quietly check nothing.
    expect(checked).toBeGreaterThan(30);
  });
});

describe('the app’s screens', () => {
  // The dev-only UI catalogue never ships, so it may show sample text as it is.
  const screens = sourceFiles(join(root, 'src')).filter((path) => path.endsWith('.tsx') && !path.includes('catalogue'));
  const LABELS = new Set(['aria-label', 'title', 'placeholder', 'label', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'phase', 'hint', 'description']);

  it('show no words that skip the translation files', () => {
    const plain: string[] = [];
    for (const path of screens) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const where = (node: ts.Node) => `${path.slice(root.length + 1)}:${String(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && /\p{L}{2,}/u.test(node.text)) plain.push(`${where(node)} ${node.text.trim()}`);
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && LABELS.has(node.name.getText()) && /\p{L}{2,}/u.test(node.initializer.text)) {
          plain.push(`${where(node)} ${node.name.getText()}="${node.initializer.text}"`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(plain).toEqual([]);
  });
});
