import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The contract between the page and Rust (6.14, docs/DESKTOP_GAPS.md, "The cheapest cover", item 2). Every other test of
// a desktop path mocks `invoke` or uses a browser stand-in, so a command or argument named differently on the two sides
// (#144's kind of bug) passed every test and failed only in the app. This reads both sides as source text: the commands
// lib.rs registers and each one's parameters, every way the page reaches `invoke`, and the events each side names.
// Names and argument keys only: what a command answers is out of scope.

const root = join(import.meta.dirname, '../..');
const rel = (path: string) => relative(root, path).split('\\').join('/');

function filesUnder(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(path, keep, out);
    else if (keep(entry.name)) out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rust's side

/**
 * Where the string, raw string, char literal or comment starting at `i` ends (its last character), with whether it is
 * a comment; null when none starts there. Shared by the comment stripper and the test-module finder, so a quote or a
 * brace inside one never counts.
 */
function rustToken(code: string, i: number): { end: number; comment: boolean } | null {
  const c = code.charAt(i);
  const raw = /^r(#*)"/.exec(code.slice(i, i + 64));
  if (raw && !/[\w]/.test(code[i - 1] === 'b' ? (code[i - 2] ?? '') : (code[i - 1] ?? ''))) {
    // r"…", r#"…"#, br#"…"#: no escapes, ended by a quote and as many hashes.
    const close = `"${raw[1] ?? ''}`;
    const end = code.indexOf(close, i + raw[0].length);
    return { end: end < 0 ? code.length - 1 : end + close.length - 1, comment: false };
  }
  if (c === "'") {
    // A char literal such as '"' or '\u{2019}', which mustn't start a string; anything else is a lifetime.
    if (code[i + 1] === '\\') {
      const end = code.indexOf("'", i + 3);
      return end < 0 ? null : { end, comment: false };
    }
    return code[i + 2] === "'" ? { end: i + 2, comment: false } : null;
  }
  if (c === '"') {
    // A string, kept as it is; a backslash escapes the next character.
    let end = i + 1;
    while (end < code.length && code[end] !== '"') end += code[end] === '\\' ? 2 : 1;
    return { end, comment: false };
  }
  if (c === '/' && code[i + 1] === '/') {
    const end = code.indexOf('\n', i);
    return { end: (end < 0 ? code.length : end) - 1, comment: true };
  }
  if (c === '/' && code[i + 1] === '*') {
    const end = code.indexOf('*/', i + 2);
    return { end: end < 0 ? code.length - 1 : end + 1, comment: true };
  }
  return null;
}

/**
 * Rust source without its `#[cfg(test)] mod … { }` blocks (their strings are fixtures), wherever they sit: code after a
 * test module is kept and read. A test module whose braces don't close fails loudly rather than hiding what follows.
 */
function withoutTestModules(text: string): string {
  let code = text;
  for (;;) {
    const start = /^[ \t]*#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/m.exec(code);
    if (!start) return code;
    let depth = 0;
    let end = -1;
    for (let i = start.index + start[0].length - 1; i < code.length; i += 1) {
      const token = rustToken(code, i);
      if (token) {
        i = token.end;
        continue;
      }
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}' && (depth -= 1) === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error(`A #[cfg(test)] module's braces don't close (at "${start[0].trim()}"); the contract test can't tell where it ends`);
    code = code.slice(0, start.index) + code.slice(end + 1);
  }
}

/** Rust source without comments and test modules; strings are kept as they are. */
function rustCode(text: string): string {
  const code = withoutTestModules(text);
  let out = '';
  for (let i = 0; i < code.length; i += 1) {
    const token = rustToken(code, i);
    if (token) {
      if (!token.comment) out += code.slice(i, token.end + 1);
      i = token.end;
    } else {
      out += code.charAt(i);
    }
  }
  return out;
}

/** Splits at the commas outside any (), <> or [], from just after an opening bracket to its match. */
function splitTopLevel(text: string, from: number): { parts: string[]; end: number } {
  const parts: string[] = [];
  let depth = 0;
  let part = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '(' || c === '[' || c === '{' || (c === '<' && text[i - 1] !== '<')) depth += 1;
    else if (c === ')' || c === ']' || c === '}' || (c === '>' && text[i - 1] !== '-' && text[i - 1] !== '=')) {
      if (depth === 0) {
        if (part.trim()) parts.push(part.trim());
        return { parts, end: i };
      }
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      if (part.trim()) parts.push(part.trim());
      part = '';
      continue;
    }
    part += c;
  }
  throw new Error('Unbalanced brackets');
}

/** Tauri's name for a Rust parameter: camelCase unless the command says rename_all = "snake_case" (heck's rule). */
function argumentName(name: string, renameAll: string | null): string {
  if (renameAll === 'snake_case') return name;
  if (renameAll !== null && renameAll !== 'camelCase') throw new Error(`rename_all = "${renameAll}" isn't handled here`);
  const words = name.split('_').filter(Boolean);
  return words.map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join('');
}

// Parameters Tauri fills in itself, by their type; the page never sends them. A `Channel` is not one of them: the page
// makes it (new Channel()) and sends it under the parameter's name, as Tauri reads it from the arguments.
const INJECTED = new Set(['AppHandle', 'Window', 'WebviewWindow', 'Webview', 'State', 'CommandScope', 'GlobalScope']);

interface RustParam {
  /** The key the page sends. */
  key: string;
  optional: boolean;
}

interface RustCommand {
  /** `module::name` as lib.rs registers it (`name` alone in lib.rs itself). */
  path: string;
  name: string;
  file: string;
  params: RustParam[];
  /** It reads the raw request body (tauri::ipc::Request), so the page sends bytes, not keys. */
  raw: boolean;
}

/** The type's own name: `tauri::State<'_, OpenFiles>` is State. */
const baseType = (type: string) => (type.replace(/^&\s*(mut\s+)?/, '').split('<')[0] ?? '').split('::').pop()?.trim() ?? '';

/** Every `#[tauri::command]` function in one Rust file, with the parameters the page must or may send. */
function rustCommands(file: string, text: string, module: string): RustCommand[] {
  const code = rustCode(text);
  const usesRequest = /use tauri::ipc::(\{[^}]*\bRequest\b[^}]*\}|Request\b)/.test(code);
  const found: RustCommand[] = [];
  const attribute = /#\[tauri::command(?:\(([^)]*)\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  for (const match of code.matchAll(attribute)) {
    const options = match[1] ?? '';
    const renameAll = /rename_all\s*=\s*"([^"]+)"/.exec(options)?.[1] ?? null;
    const name = match[2] ?? '';
    const { parts } = splitTopLevel(code, match.index + match[0].length);
    const params: RustParam[] = [];
    let raw = false;
    for (const part of parts) {
      const colon = part.search(/:(?!:)/);
      const pattern = part.slice(0, colon).replace(/^mut\s+/, '').trim();
      const type = part.slice(colon + 1).trim();
      const base = baseType(type);
      if (base === 'Request' && (type.includes('ipc::Request') || usesRequest)) {
        raw = true;
        continue;
      }
      if (INJECTED.has(base)) continue;
      params.push({ key: argumentName(pattern, renameAll), optional: /^(std::option::)?Option\s*</.test(type) });
    }
    found.push({ path: module ? `${module}::${name}` : name, name, file, params, raw });
  }
  return found;
}

/** The commands lib.rs hands to `tauri::generate_handler!`, as written there (`sbd::sbd_create`). */
function registeredCommands(libText: string): string[] {
  const list = /generate_handler!\s*\[([^\]]*)\]/.exec(rustCode(libText))?.[1] ?? '';
  return list
    .split(',')
    .map((entry) => entry.trim().replace(/^crate::/, ''))
    .filter(Boolean);
}

/** The value of `const NAME: &str = "…"`, in this file first, then anywhere in the crate. */
function rustConstant(name: string, code: string, crate: string): string | null {
  const constant = new RegExp(`const\\s+${name}\\s*:\\s*&(?:'static\\s+)?str\\s*=\\s*"([^"]*)"`);
  return constant.exec(code)?.[1] ?? constant.exec(crate)?.[1] ?? null;
}

/**
 * The events one Rust file emits by name (`emit`, `emit_to`, `emit_filter`, `emit_str`), as a method or as a function
 * call (`Emitter::emit(&app, …)`, whose first argument is the emitter), or what it couldn't read.
 */
function rustEmits(file: string, text: string, crate = ''): { name: string | null; file: string; said: string }[] {
  const code = rustCode(text);
  const out: { name: string | null; file: string; said: string }[] = [];
  for (const match of code.matchAll(/(\.|\bEmitter\s*>?\s*::\s*)(emit|emit_to|emit_str|emit_str_to|emit_filter|emit_str_filter)\s*\(/g)) {
    const { parts } = splitTopLevel(code, match.index + match[0].length);
    const at = (match[1] === '.' ? 0 : 1) + (match[2]?.endsWith('_to') ? 1 : 0);
    const arg = parts[at] ?? '';
    const literal = /^"([^"]*)"$/.exec(arg)?.[1];
    const name = literal ?? (/^[A-Za-z_][\w:]*$/.test(arg) ? rustConstant(arg.split('::').pop() ?? '', code, crate) : null);
    out.push({ name, file, said: arg });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The page's side

/**
 * Functions that hand a command name and arguments straight to `invoke`, so a call of one is a call of the command
 * it names. Found by the test (an `invoke` whose name is the function's own parameter), so a new one fails until it is
 * listed here with why it exists.
 */
const WRAPPERS: Record<string, Record<string, string>> = {
  'src/core/storage/tauriDriver.ts': { command: 'turns a command’s rejection, a plain string, into an Error; used by storage, app data, opened files and synced folders' },
  'src/app/playback.ts': { call: 'the same, for the playback copies, the known videos and the licences' },
};

/**
 * Calls whose name or arguments aren't a literal the test can read, by file and command, each with why. The test fails
 * on any unlisted one, and on a listing nothing matches any more.
 */
const UNREADABLE: Record<string, Record<string, string>> = {
  'src/core/storage/tauriDriver.ts': {
    sbd_tx_raw: 'a transaction carrying bytes goes as the raw request body (packRawTx), which sbd_tx_raw reads through tauri::ipc::Request',
  },
  'src/core/storage/exportFiles.ts': {
    export_write: 'the export goes as the raw request body (writeBody: a JSON header, then the bytes), read through tauri::ipc::Request',
  },
};

/** Registered commands the page never calls, each with why (called only from Rust, or kept on purpose). None today. */
const NEVER_CALLED: Record<string, string> = {};

/**
 * Events Tauri emits itself, which Rust never names, that the page listens to, each with why. None today (the page
 * hears dropped pictures through Rust's own events): a first use adds its entry, and an entry nothing listens to fails.
 */
const BUILT_IN_EVENTS: Record<string, string> = {};

/**
 * What the page may import from @tauri-apps/api, by module: the names this test reads (invoke, listen, once and the
 * window getters whose listeners it follows) and ones that never reach a command of ours. Any other import from the
 * package, its root included (`import { core } from '@tauri-apps/api'`), and any re-export from it, fails, so no way of
 * reaching `invoke` goes unread.
 */
const KNOWN_TAURI_IMPORTS: Record<string, Record<string, string>> = {
  '@tauri-apps/api/core': {
    invoke: 'read: every call is checked',
    Channel: 'made by the page and sent as an argument; it calls no command',
    convertFileSrc: 'turns a path into an asset URL; it calls no command',
    isTauri: 'says whether the page runs in the app; it calls no command',
  },
  '@tauri-apps/api/event': { listen: 'read: every event name is checked', once: 'read, as listen' },
  '@tauri-apps/api/path': {
    appDataDir: 'Tauri’s own path plugin, not a command of ours',
    join: 'Tauri’s own path plugin, not a command of ours',
  },
  '@tauri-apps/api/webviewWindow': { getCurrentWebviewWindow: 'read: its listen, once and on… helpers are followed' },
  '@tauri-apps/api/webview': { getCurrentWebview: 'read: its listen, once and on… helpers are followed' },
  '@tauri-apps/api/window': { getCurrentWindow: 'read: its listen, once and on… helpers are followed' },
};

const isTauriApi = (from: string) => from === '@tauri-apps/api' || from.startsWith('@tauri-apps/api/');

/** The window helpers that listen to Tauri's built-in events, and which. */
const WINDOW_HELPERS: Record<string, string[]> = {
  onDragDropEvent: ['tauri://drag-enter', 'tauri://drag-over', 'tauri://drag-drop', 'tauri://drag-leave'],
  onCloseRequested: ['tauri://close-requested'],
  onResized: ['tauri://resize'],
  onFocusChanged: ['tauri://focus', 'tauri://blur'],
};

interface PageCall {
  file: string;
  line: number;
  /** The command, or null when it isn't a literal. */
  name: string | null;
  /** The argument object's keys, or null when it isn't an object literal of plain keys (bytes, a variable, a spread). */
  keys: string[] | null;
}

interface PageListen {
  file: string;
  line: number;
  name: string | null;
}

interface PageScan {
  file: string;
  calls: PageCall[];
  listens: PageListen[];
  /** Wrappers found in this file: an `invoke` whose name is the function's own parameter. */
  wrappers: string[];
  /** Anything that reaches Tauri in a way the contract doesn't read, said in words. */
  uncovered: string[];
}

const literalText = (node: ts.Node | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** The keys of an object literal of plain keys; null for anything else. Left out, the arguments are none. */
function objectKeys(node: ts.Expression | undefined): string[] | null {
  if (node === undefined) return [];
  if (!ts.isObjectLiteralExpression(node)) return null;
  const keys: string[] = [];
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) keys.push(property.name.text);
    else if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) keys.push(property.name.text);
    else return null;
  }
  return keys;
}

/** The function a node sits in, by the name it's declared or assigned under, and its first parameter's name. */
function enclosingFunction(node: ts.Node): { name: string | null; firstParam: string | null } | null {
  const at = ts.findAncestor(node.parent, (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n));
  if (!at || !(ts.isFunctionDeclaration(at) || ts.isFunctionExpression(at) || ts.isArrowFunction(at) || ts.isMethodDeclaration(at))) return null;
  const first = at.parameters[0]?.name;
  let name: string | null = at.name && ts.isIdentifier(at.name) ? at.name.text : null;
  if (name === null && ts.isVariableDeclaration(at.parent) && ts.isIdentifier(at.parent.name)) name = at.parent.name.text;
  return { name, firstParam: first && ts.isIdentifier(first) ? first.text : null };
}

/** A `const NAME = '…'` in the file, for an event name kept in a constant. */
function constantText(source: ts.SourceFile, name: string): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = literalText(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Reads one page file: its calls of `invoke` and of the wrappers it may use (`reach`: local name to wrapper, given by
 * the caller from the file's imports and WRAPPERS), and the events it listens to.
 */
function scanPage(file: string, text: string, importedWrappers: Set<string> = new Set()): PageScan {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const scan: PageScan = { file, calls: [], listens: [], wrappers: [], uncovered: [] };
  const invokeNames = new Set<string>();
  const listenNames = new Set<string>();
  const ownWrappers = new Set(Object.keys(WRAPPERS[file] ?? {}));
  let windowApi = false;
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && isTauriApi(statement.moduleSpecifier.text)) {
      // `export { invoke } from '@tauri-apps/api/core'`, `export * from …`: a call through the re-export couldn't be read.
      // Types alone (`export type { … }`, `export { type InvokeArgs }`) carry no call.
      const clause = statement.exportClause;
      const typesOnly = statement.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.every((element) => element.isTypeOnly));
      if (!typesOnly) scan.uncovered.push(`${file}: re-exports from ${statement.moduleSpecifier.text}, which this test can't follow`);
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    if (!isTauriApi(from)) continue;
    const clause = statement.importClause;
    if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const known = KNOWN_TAURI_IMPORTS[from];
    if (known === undefined) {
      scan.uncovered.push(`${file}: imports from ${from}, which this test doesn't read; list what it may import in KNOWN_TAURI_IMPORTS with why`);
      continue;
    }
    if (/^@tauri-apps\/api\/(window|webview|webviewWindow)$/.test(from)) windowApi = true;
    if (clause.name) scan.uncovered.push(`${file}: imports ${from}'s default, which this test can't follow`);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      scan.uncovered.push(`${file}: imports all of ${from} as one name, which this test can't follow`);
      continue;
    }
    for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (known[imported] === undefined) scan.uncovered.push(`${file}: imports ${imported} from ${from}, which this test doesn't read; list it in KNOWN_TAURI_IMPORTS with why`);
      else if (from === '@tauri-apps/api/core' && imported === 'invoke') invokeNames.add(element.name.text);
      else if (from === '@tauri-apps/api/event' && (imported === 'listen' || imported === 'once')) listenNames.add(element.name.text);
    }
  }
  const reach = new Set([...invokeNames, ...ownWrappers, ...importedWrappers]);
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node: ts.Node) => {
    // Tauri's own internals, reached past @tauri-apps/api (6.15 review): a call through them couldn't be read.
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === TAURI_INTERNALS) {
      scan.uncovered.push(`${file}:${String(line(node))}: reaches ${TAURI_INTERNALS}, past @tauri-apps/api, which this test can't follow`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const from = literalText(node.arguments[0]);
      if (from === null || isTauriApi(from)) scan.uncovered.push(`${file}:${String(line(node))}: imports ${from ?? 'a module named at run time'} dynamically, which this test can't follow`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && reach.has(node.expression.text)) {
      const [nameArg, argsArg] = node.arguments;
      const name = literalText(nameArg);
      const within = enclosingFunction(node);
      const passesThrough =
        name === null && invokeNames.has(node.expression.text) && nameArg !== undefined && ts.isIdentifier(nameArg) && within?.firstParam === nameArg.text;
      if (passesThrough) scan.wrappers.push(within.name ?? '(anonymous)');
      else scan.calls.push({ file, line: line(node), name, keys: objectKeys(argsArg) });
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && listenNames.has(node.expression.text)) {
      const arg = node.arguments[0];
      const name = literalText(arg) ?? (arg && ts.isIdentifier(arg) ? constantText(source, arg.text) : null);
      scan.listens.push({ file, line: line(node), name });
    } else if (windowApi && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === 'listen' || method === 'once') {
        const arg = node.arguments[0];
        const name = literalText(arg) ?? (arg && ts.isIdentifier(arg) ? constantText(source, arg.text) : null);
        scan.listens.push({ file, line: line(node), name });
      } else if (method in WINDOW_HELPERS) {
        for (const name of WINDOW_HELPERS[method] ?? []) scan.listens.push({ file, line: line(node), name });
      } else if (/^on[A-Z]/.test(method)) {
        scan.uncovered.push(`${file}:${String(line(node))}: ${method} listens to a Tauri event this test doesn't know`);
      }
    } else if (ts.isIdentifier(node) && invokeNames.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      // invoke handed on as a value (kept, renamed, passed): a call through it couldn't be read.
      const callee = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!callee) scan.uncovered.push(`${file}:${String(line(node))}: invoke is used other than as a call`);
    } else if (ts.isIdentifier(node) && importedWrappers.has(node.text) && !ts.isImportSpecifier(node.parent) && !isPropertyName(node)) {
      // An imported wrapper handed on (re-exported, kept, passed), as invoke above.
      const callee = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!callee) scan.uncovered.push(`${file}:${String(line(node))}: the wrapper ${node.text} is used other than as a call`);
    } else if (ts.isIdentifier(node) && ownWrappers.has(node.text) && !isPropertyName(node) && !isDeclaredName(node)) {
      // The wrapper's own file handing it on (6.15 review): under another name (`export { command as run }`), in an
      // object (`export const db = { command }`), kept or passed. Exported under its own name, others import it as such.
      const callee = ts.isCallExpression(node.parent) && node.parent.expression === node;
      const asItself = ts.isExportSpecifier(node.parent) && node.parent.propertyName === undefined;
      if (!callee && !asItself) scan.uncovered.push(`${file}:${String(line(node))}: the wrapper ${node.text} is handed on other than by its own name, which this test can't follow`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return scan;
}

const TAURI_INTERNALS = '__TAURI_INTERNALS__';

/** The name a function, variable or parameter is declared under, not a use of it. */
const isDeclaredName = (node: ts.Identifier) =>
  (ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent)) && node.parent.name === node;

/** A name that is a property's (`x.call`, `{ command: … }`), not a reference to a variable. */
const isPropertyName = (node: ts.Identifier) =>
  (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
  ((ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node);

/** The file a relative module specifier names, as WRAPPERS keys it, or null when it names no file of src. */
function wrapperFile(file: string, from: string): string | null {
  if (!from.startsWith('.')) return null;
  const target = rel(resolve(dirname(join(root, file)), from)).replace(/\.(ts|tsx|js)$/, '');
  return [`${target}.ts`, `${target}.tsx`].find((path) => path in WRAPPERS) ?? null;
}

/**
 * The wrappers a file imports from WRAPPERS' files, by their local names, and every way it reaches one the test can't
 * follow: a WRAPPERS name imported from anywhere but the listed wrapper's own file (a barrel, a path that isn't
 * relative), a wrapper file's namespace or default, and a re-export of a wrapper.
 */
function importedWrappers(file: string, text: string): { names: Set<string>; uncovered: string[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const wrapperNames = new Set(Object.values(WRAPPERS).flatMap((names) => Object.keys(names)));
  const names = new Set<string>();
  const uncovered: string[] = [];
  for (const statement of source.statements) {
    const declaration = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement : null;
    if (!declaration?.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) continue;
    const from = declaration.moduleSpecifier.text;
    const target = wrapperFile(file, from);
    const wrappers = target === null ? undefined : WRAPPERS[target];
    if (ts.isExportDeclaration(declaration)) {
      if (declaration.isTypeOnly) continue;
      const clause = declaration.exportClause;
      const named = clause && ts.isNamedExports(clause) ? clause.elements.map((element) => (element.propertyName ?? element.name).text) : null;
      if (wrappers && named === null) uncovered.push(`${file}: re-exports all of ${from}, a wrapper's file, which this test can't follow`);
      for (const name of named ?? []) if (wrapperNames.has(name)) uncovered.push(`${file}: re-exports ${name} from ${from}, which this test can't follow`);
      continue;
    }
    const clause = declaration.importClause;
    if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = clause.namedBindings;
    if (wrappers && (clause.name || (bindings && ts.isNamespaceImport(bindings)))) uncovered.push(`${file}: imports ${from}, a wrapper's file, other than by name, which this test can't follow`);
    for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
      if (element.isTypeOnly) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (!wrapperNames.has(imported)) continue;
      if (wrappers?.[imported] !== undefined) names.add(element.name.text);
      else uncovered.push(`${file}: imports ${imported} from ${from}, which isn't the listed wrapper's own file (WRAPPERS); import it from there`);
    }
  }
  return { names, uncovered };
}

// ---------------------------------------------------------------------------------------------------------------------
// Both sides, read once

const rustFiles = filesUnder(join(root, 'src-tauri/src'), (name) => name.endsWith('.rs'));
const crateText = rustFiles.map((path) => rustCode(readFileSync(path, 'utf8'))).join('\n');
const rustModule = (path: string) => {
  const inside = relative(join(root, 'src-tauri/src'), path).split('\\').join('/').replace(/\.rs$/, '');
  return inside === 'lib' || inside === 'main' ? '' : inside.replace(/\/mod$/, '').split('/').join('::');
};
const commands = new Map(
  rustFiles.flatMap((path) => rustCommands(rel(path), readFileSync(path, 'utf8'), rustModule(path))).map((command) => [command.path, command]),
);
const registered = registeredCommands(readFileSync(join(root, 'src-tauri/src/lib.rs'), 'utf8'));
const registeredByName = new Map<string, RustCommand>();
for (const path of registered) {
  const command = commands.get(path);
  if (command) registeredByName.set(command.name, command);
}
const rustEvents = rustFiles.flatMap((path) => rustEmits(rel(path), readFileSync(path, 'utf8'), crateText));

const pageFiles = filesUnder(join(root, 'src'), (name) => /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts'));
const pages = pageFiles.map((path) => {
  const file = rel(path);
  const text = readFileSync(path, 'utf8');
  const wrappers = importedWrappers(file, text);
  const scan = scanPage(file, text, wrappers.names);
  scan.uncovered.push(...wrappers.uncovered);
  return scan;
});
const calls = pages.flatMap((page) => page.calls);
const where = (call: PageCall | PageListen) => `${call.file}:${String(call.line)}`;

describe('the contract between the page and Rust (6.14)', () => {
  it('reads both sides: lib.rs’s commands, their parameters, and the page’s calls', () => {
    // A change to how either side is written mustn't quietly check nothing.
    expect(registered.length).toBeGreaterThan(60);
    expect(calls.length).toBeGreaterThan(60);
    expect(commands.get('video::clip_save')?.params.map((p) => p.key)).toEqual(['path', 'handle', 'inFrame', 'outFrame', 'fpsNum', 'fpsDen', 'window', 'lut', 'dest']);
    expect(commands.get('sbd::sbd_tx_raw')?.raw).toBe(true);
  });

  it('registers a #[tauri::command] function for every name lib.rs hands to generate_handler!', () => {
    expect(registered.filter((path) => !commands.has(path)).map((path) => `lib.rs registers ${path}, but no #[tauri::command] fn ${path} is in src-tauri/src`)).toEqual([]);
  });

  it('finds every way the page reaches invoke, and nothing it can’t follow', () => {
    const problems = pages.flatMap((page) => page.uncovered);
    for (const page of pages) {
      for (const wrapper of page.wrappers) {
        if (WRAPPERS[page.file]?.[wrapper] === undefined) problems.push(`${page.file}: ${wrapper} hands its own name to invoke; list it in WRAPPERS with why`);
      }
    }
    // Each listed wrapper is still one, in its own file.
    for (const [path, names] of Object.entries(WRAPPERS)) {
      const page = pages.find((p) => p.file === path);
      for (const name of Object.keys(names)) if (!page?.wrappers.includes(name)) problems.push(`${path}: WRAPPERS lists ${name}, which no longer hands its name to invoke`);
    }
    expect(problems).toEqual([]);
  });

  it('lists every call it can’t read, with why, and nothing more', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const call of calls.filter((c) => c.name === null || c.keys === null)) {
      const key = call.name ?? '(a name that isn’t a literal)';
      if (UNREADABLE[call.file]?.[key] === undefined) problems.push(`${where(call)}: a call of ${key} whose ${call.name === null ? 'name' : 'arguments'} the test can’t read; list it in UNREADABLE with why`);
      seen.add(`${call.file} ${key}`);
    }
    for (const [file, names] of Object.entries(UNREADABLE)) for (const name of Object.keys(names)) if (!seen.has(`${file} ${name}`)) problems.push(`${file}: UNREADABLE lists ${name}, which it no longer has`);
    expect(problems).toEqual([]);
  });

  it('calls only commands lib.rs registers', () => {
    expect(calls.filter((call) => call.name !== null && !registeredByName.has(call.name)).map((call) => `${where(call)}: calls ${String(call.name)}, which lib.rs doesn’t register`)).toEqual([]);
  });

  it('calls every command lib.rs registers, or says why not', () => {
    const called = new Set(calls.map((call) => call.name));
    const problems = [...registeredByName.keys()].filter((name) => !called.has(name) && NEVER_CALLED[name] === undefined).map((name) => `${name} is registered but the page never calls it; list it in NEVER_CALLED with why`);
    for (const name of Object.keys(NEVER_CALLED)) if (called.has(name) || !registeredByName.has(name)) problems.push(`NEVER_CALLED lists ${name}, which is called or no longer registered`);
    expect(problems).toEqual([]);
  });

  it('passes each command only the arguments Rust takes, and every one that isn’t an Option', () => {
    const problems: string[] = [];
    for (const call of calls) {
      const command = call.name === null ? undefined : registeredByName.get(call.name);
      if (!command || call.keys === null) continue;
      if (command.raw) {
        problems.push(`${where(call)}: ${command.name} reads the raw request body (${command.file}), but the call sends keys`);
        continue;
      }
      const taken = new Set(command.params.map((p) => p.key));
      for (const key of call.keys) if (!taken.has(key)) problems.push(`${where(call)}: ${command.name} is passed ${key}, which ${command.file} doesn’t take (it takes ${[...taken].join(', ') || 'none'})`);
      for (const param of command.params) if (!param.optional && !call.keys.includes(param.key)) problems.push(`${where(call)}: ${command.name} is missing ${param.key}, which ${command.file} needs`);
    }
    expect(problems).toEqual([]);
  });

  it('listens only to events Rust emits by name or Tauri emits itself, and every event Rust emits is listened to', () => {
    const listens = pages.flatMap((page) => page.listens);
    // The scan still finds them: opened-files and the two picture-drag events.
    expect(listens.length).toBeGreaterThanOrEqual(3);
    expect(rustEvents.length).toBeGreaterThanOrEqual(3);
    const emitted = new Set(rustEvents.map((event) => event.name));
    const heard = new Set(listens.map((listen) => listen.name));
    const problems = [
      ...rustEvents.filter((event) => event.name === null).map((event) => `${event.file}: emits ${event.said}, a name the test can’t read`),
      ...listens.filter((listen) => listen.name === null).map((listen) => `${where(listen)}: listens to a name the test can’t read`),
      ...listens
        .filter((listen) => listen.name !== null && !emitted.has(listen.name) && BUILT_IN_EVENTS[listen.name] === undefined)
        .map((listen) => `${where(listen)}: listens to ${String(listen.name)}, which Rust never emits`),
      ...rustEvents
        .filter((event) => event.name !== null && !heard.has(event.name))
        .map((event) => `${event.file}: emits ${String(event.name)}, which the page never listens to`),
      ...Object.keys(BUILT_IN_EVENTS)
        .filter((name) => !heard.has(name))
        .map((name) => `BUILT_IN_EVENTS lists ${name}, which the page doesn’t listen to; take it out`),
    ];
    expect(problems).toEqual([]);
  });
});

describe('the contract’s own readers', () => {
  it('leave out what Tauri injects, mark an Option as optional and name arguments in camelCase', () => {
    const [command] = rustCommands(
      'x.rs',
      `#[tauri::command]
pub async fn video_still(app: AppHandle, files: State<'_, OpenFiles>, window: tauri::Window, path: String, fps_num: u32, lut: Option<crate::playback::Lut>) -> Result<(), String> { Ok(()) }`,
      'video',
    );
    expect(command).toEqual({
      path: 'video::video_still',
      name: 'video_still',
      file: 'x.rs',
      raw: false,
      params: [
        { key: 'path', optional: false },
        { key: 'fpsNum', optional: false },
        { key: 'lut', optional: true },
      ],
    });
  });

  it('read a multi-line signature under other attributes and a doc comment, with a Channel the page sends', () => {
    const commands = rustCommands(
      'x.rs',
      `/// Makes a copy.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn playback_make(
    app: tauri::AppHandle,
    // the file
    path: String,
    in_frame: u64,
    window: ClipWindow,
    progress: Channel<Progress>,
) -> Result<MadeCopy, String> {}

#[tauri::command(async)]
pub fn playback_cancel(app: AppHandle, lut: Option<String>) -> bool { true }`,
      'playback',
    );
    expect(commands.map((c) => [c.name, c.params.map((p) => p.key)])).toEqual([
      ['playback_make', ['path', 'inFrame', 'window', 'progress']],
      ['playback_cancel', ['lut']],
    ]);
  });

  it('keep snake_case names under rename_all, and mark a raw-body command', () => {
    const [renamed, raw] = rustCommands(
      'x.rs',
      `#[tauri::command(rename_all = "snake_case")]
fn tile_at(zoom_level: u8, x: u32) {}
#[tauri::command]
pub async fn export_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {}`,
      '',
    );
    expect(renamed?.params.map((p) => p.key)).toEqual(['zoom_level', 'x']);
    expect(renamed?.path).toBe('tile_at');
    expect(raw?.raw).toBe(true);
    expect(raw?.params).toEqual([]);
  });

  it('read lib.rs’s list and the events Rust emits, a constant’s value included', () => {
    expect(registeredCommands('.invoke_handler(tauri::generate_handler![\n  sbd::sbd_open,\n  // gone::old,\n  open::open_link,\n])')).toEqual(['sbd::sbd_open', 'open::open_link']);
    const emits = rustEmits('x.rs', `pub const DROPPED: &str = "storiiboard://dropped";\nfn f() { let _ = window.emit(\n DROPPED,\n Dropped { paths, at },\n); app.emit_to("main", "opened-files", ()); app.emit(name, ()); }`);
    expect(emits.map((e) => e.name)).toEqual(['storiiboard://dropped', 'opened-files', null]);
  });

  it('read the page’s calls through invoke and a wrapper, and say which it can’t read', () => {
    const scan = scanPage(
      'src/app/x.ts',
      `import { invoke as call } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
const DROPPED = 'storiiboard://dropped';
export async function command(name: string, args?: Record<string, unknown>) { return call(name, args); }
await call<string[]>('pictures_choose', { multiple, title: 'Pictures', 'kind': t('x') });
await command('sbd_close', { handle });
await call('services_status');
await call('export_write', body(path, bytes));
await call('sbd_query', { ...rest, sql });
listen(DROPPED, () => {});`,
    );
    expect(scan.wrappers).toEqual(['command']);
    expect(scan.uncovered).toEqual([]);
    expect(scan.calls.map((c) => [c.name, c.keys])).toEqual([
      ['pictures_choose', ['multiple', 'title', 'kind']],
      ['services_status', []],
      ['export_write', null],
      ['sbd_query', null],
    ]);
    expect(scan.listens.map((l) => l.name)).toEqual(['storiiboard://dropped']);
    // The wrapper's own calls are read in files that import it.
    expect(scanPage('src/app/y.ts', `await command('sbd_close', { handle });`, new Set(['command'])).calls).toEqual([{ file: 'src/app/y.ts', line: 1, name: 'sbd_close', keys: ['handle'] }]);
  });

  // 6.15's review: a wrapper's own file handing it on under another name, Tauri's internals, and a type re-exported.
  it('refuse a wrapper re-exported by its own file under another name, and Tauri’s internals anywhere', () => {
    const driver = 'src/core/storage/tauriDriver.ts';
    const wrapper = `import { invoke } from '@tauri-apps/api/core';\nexport async function command(name: string, args?: Record<string, unknown>) { return invoke(name, args); }\n`;
    expect(scanPage(driver, `${wrapper}export { command as run };`).uncovered).toEqual([`${driver}:3: the wrapper command is handed on other than by its own name, which this test can't follow`]);
    expect(scanPage(driver, `${wrapper}export const db = { command };`).uncovered).toHaveLength(1);
    expect(scanPage(driver, `${wrapper}export const db = { run: command };`).uncovered).toHaveLength(1);
    expect(scanPage(driver, `${wrapper}const run = command;`).uncovered).toHaveLength(1);
    // Its own name, and its own calls, are how others read it.
    expect(scanPage(driver, `${wrapper}export { command };\nawait command('sbd_close', { handle });`)).toMatchObject({ uncovered: [], wrappers: ['command'] });
    expect(scanPage('src/app/x.ts', `const internals = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;`).uncovered).toHaveLength(2);
    expect(scanPage('src/app/x.ts', `const ok = '__TAURI_INTERNALS__' in window;`).uncovered).toEqual(["src/app/x.ts:1: reaches __TAURI_INTERNALS__, past @tauri-apps/api, which this test can't follow"]);
    expect(scanPage('src/app/x.ts', `const v = window['__TAURI_INTERNALS__'];`).uncovered).toHaveLength(1);
    // A type re-exported carries no call.
    expect(scanPage('src/app/x.ts', `export { type InvokeArgs } from '@tauri-apps/api/core';`).uncovered).toEqual([]);
    expect(scanPage('src/app/x.ts', `export type { InvokeArgs } from '@tauri-apps/api/core';`).uncovered).toEqual([]);
    expect(scanPage('src/app/x.ts', `export { type InvokeArgs, invoke } from '@tauri-apps/api/core';`).uncovered).toHaveLength(1);
  });

  it('say so when invoke is kept or passed rather than called', () => {
    expect(scanPage('src/app/x.ts', `import { invoke } from '@tauri-apps/api/core';\nconst run = invoke;`).uncovered).toEqual(['src/app/x.ts:2: invoke is used other than as a call']);
  });

  // 6.14's review: ways of reaching invoke the first version didn't see.
  it('refuse a re-export of invoke, or of anything from @tauri-apps/api', () => {
    expect(scanPage('src/app/x.ts', `export { invoke } from '@tauri-apps/api/core';`).uncovered).toEqual(["src/app/x.ts: re-exports from @tauri-apps/api/core, which this test can't follow"]);
    expect(scanPage('src/app/x.ts', `export * from '@tauri-apps/api/core';`).uncovered).toHaveLength(1);
    expect(scanPage('src/app/x.ts', `export { Channel as Pipe } from "@tauri-apps/api/core";`).uncovered).toHaveLength(1);
    expect(scanPage('src/app/x.ts', `import { invoke } from '@tauri-apps/api/core';\nexport { invoke };`).uncovered).toEqual(['src/app/x.ts:2: invoke is used other than as a call']);
  });

  it('refuse an import from the root package or from a module, or of a name, it doesn’t know', () => {
    expect(scanPage('src/app/x.ts', `import { core } from '@tauri-apps/api';\nawait core.invoke('sbd_close', { handel });`).uncovered).toEqual([
      "src/app/x.ts: imports from @tauri-apps/api, which this test doesn't read; list what it may import in KNOWN_TAURI_IMPORTS with why",
    ]);
    expect(scanPage('src/app/x.ts', `import { Resource } from '@tauri-apps/api/core';`).uncovered).toEqual([
      "src/app/x.ts: imports Resource from @tauri-apps/api/core, which this test doesn't read; list it in KNOWN_TAURI_IMPORTS with why",
    ]);
    expect(scanPage('src/app/x.ts', `import { emit } from '@tauri-apps/api/event';`).uncovered).toHaveLength(1);
    expect(scanPage('src/app/x.ts', `import { open } from '@tauri-apps/api/dpi';`).uncovered).toHaveLength(1);
    expect(scanPage('src/app/x.ts', `import * as core from '@tauri-apps/api/core';`).uncovered).toHaveLength(1);
    expect(scanPage('src/app/x.ts', `const core = await import('@tauri-apps/api/core');`).uncovered).toEqual(["src/app/x.ts:1: imports @tauri-apps/api/core dynamically, which this test can't follow"]);
    // What it knows, and types, pass; double quotes are read as single ones.
    expect(scanPage('src/app/x.ts', `import { invoke, isTauri, type InvokeArgs } from "@tauri-apps/api/core";\nimport type { UnlistenFn } from '@tauri-apps/api/event';\nawait invoke("sbd_close", { handle });`)).toMatchObject({
      uncovered: [],
      calls: [{ name: 'sbd_close', keys: ['handle'] }],
    });
  });

  it('follow a wrapper only from its own file, by a relative path in either quotes, and refuse a barrel', () => {
    const driver = 'src/core/storage/tauriDriver.ts';
    expect(WRAPPERS[driver]?.command).toBeDefined();
    // From its own file, in single or double quotes, with or without an extension, renamed or not.
    expect(importedWrappers('src/app/x.ts', `import { command } from '../core/storage/tauriDriver';`)).toEqual({ names: new Set(['command']), uncovered: [] });
    expect(importedWrappers('src/app/x.ts', `import { command as run } from "../core/storage/tauriDriver.ts";`)).toEqual({ names: new Set(['run']), uncovered: [] });
    // Through a barrel, a path that isn't relative, or the wrong wrapper's file: refused.
    expect(importedWrappers('src/app/x.ts', `import { command } from '../core/storage';`).uncovered).toEqual([
      "src/app/x.ts: imports command from ../core/storage, which isn't the listed wrapper's own file (WRAPPERS); import it from there",
    ]);
    expect(importedWrappers('src/app/x.ts', `import { command } from '@/core/storage/tauriDriver';`).uncovered).toHaveLength(1);
    expect(importedWrappers('src/app/x.ts', `import { call } from '../core/storage/tauriDriver';`).uncovered).toHaveLength(1);
    expect(importedWrappers('src/app/x.ts', `import * as driver from '../core/storage/tauriDriver';`).uncovered).toHaveLength(1);
    // A barrel's own re-exports: refused where they're written.
    expect(importedWrappers('src/core/storage/index.ts', `export * from './tauriDriver';`).uncovered).toHaveLength(1);
    expect(importedWrappers('src/core/storage/index.ts', `export { command } from './tauriDriver';`).uncovered).toHaveLength(1);
    // A wrapper imported, then handed on: refused as invoke is; a property of the same name isn't the wrapper.
    expect(scanPage('src/app/x.ts', `export { command };\nconst x = { command: 1 };\nx.command;\nawait command('sbd_close', { handle });`, new Set(['command'])).uncovered).toEqual([
      'src/app/x.ts:1: the wrapper command is used other than as a call',
    ]);
  });

  it('read code after a test module, refuse one whose braces never close, and read Emitter::emit as a call', () => {
    const text = `#[cfg(test)]
mod tests {
    fn f() { let s = "}"; let r = r#"{ "quoted" }"#; let c = '}'; }
}

#[tauri::command]
pub fn after(path: String) {}
fn g(app: &AppHandle) { let _ = Emitter::emit(app, "late", ()); let _ = tauri::Emitter::emit_to(&app, "main", "later", ()); }`;
    expect(rustCommands('x.rs', text, '').map((c) => c.name)).toEqual(['after']);
    expect(rustEmits('x.rs', text).map((e) => e.name)).toEqual(['late', 'later']);
    expect(() => rustCode('#[cfg(test)]\nmod tests {\n    fn f() {\n')).toThrow(/braces don't close/);
    // A test module's own commands and emits are fixtures, never read.
    expect(rustEmits('x.rs', '#[cfg(test)]\nmod tests {\n    fn f() { app.emit("fixture", ()); }\n}\n')).toEqual([]);
  });
});
