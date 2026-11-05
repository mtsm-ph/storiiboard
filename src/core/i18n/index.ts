import { en } from './locales/en';
import { es } from './locales/es';

// Every word the app shows (screens, notices, dialogs, exported PDFs and CSVs) comes from a translation file in
// src/core/i18n/locales, through t() and tn() here. A language is one file plus one line in LOCALES. The person picks
// it in Settings → App; it belongs to them, not the project, so a shared .sbd opens in each person's own language.
//
// Plain functions rather than a React context: notices, history summaries and exports are built outside React. The
// app's root re-renders on a change of language (src/ui/useLocale.ts), and every screen reads t() as it renders.

export type MessageKey = keyof typeof en;
/** A translation: every key English has, each with the same {placeholders}. */
export type Messages = Readonly<Record<MessageKey, string>>;

export type LocaleId = 'en' | 'es';

interface LocaleInfo {
  id: LocaleId;
  /** In its own language, so it reads right whatever language the app is in. */
  name: string;
  /** The BCP 47 tag for plural rules and <html lang>. */
  tag: string;
  /**
   * The tag dates and times are written in. English leaves it to the computer, as the app always has, so a British
   * or Canadian computer keeps its own 14:05 and 4 Nov; another language writes them its own way.
   */
  dateTag: string | undefined;
  messages: Messages;
}

export const LOCALES: readonly [LocaleInfo, ...LocaleInfo[]] = [
  { id: 'en', name: 'English', tag: 'en', dateTag: undefined, messages: en },
  // es-419: Spanish as written in Latin America, for plural rules, dates and <html lang>.
  { id: 'es', name: 'Español (Latinoamérica)', tag: 'es-419', dateTag: 'es-419', messages: es },
];

export const DEFAULT_LOCALE: LocaleId = 'en';

export function isLocaleId(value: unknown): value is LocaleId {
  return LOCALES.some((l) => l.id === value);
}

let current: LocaleInfo = LOCALES[0];
const listeners = new Set<() => void>();

export function getLocale(): LocaleId {
  return current.id;
}

export function setLocale(id: LocaleId): void {
  // Read as text: a saved setting can hold a language this version doesn't have.
  const wanted: string = id;
  const next = LOCALES.find((l) => l.id === wanted) ?? LOCALES[0];
  // Set even when unchanged, so the document says the language the app chose rather than the one index.html assumed.
  if (typeof document !== 'undefined') document.documentElement.lang = next.tag;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type Params = Readonly<Record<string, string | number>>;

/** Fills {name} placeholders. Numbers go in as written: shot numbers, lens mm and T-stops are never regrouped. */
function fill(text: string, params: Params | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** The text for a key in the current language, falling back to English for a key a translation lacks. */
export function t(key: MessageKey, params?: Params): string {
  return fill(current.messages[key] || en[key], params);
}

/**
 * Keys that come in plural forms: `<base>.one` and `<base>.other`. Every translation has the same two; a form a
 * language's rules add (Spanish "many", for a million) falls back to `.other`, which reads right there too.
 */
export type PluralBase = MessageKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

const pluralRules = new Map<string, Intl.PluralRules>();

/** Which of a counted phrase's keys the language's own plural rules pick for `count`. */
export function pluralKey(base: PluralBase, count: number): MessageKey {
  let rules = pluralRules.get(current.tag);
  if (!rules) {
    rules = new Intl.PluralRules(current.tag);
    pluralRules.set(current.tag, rules);
  }
  const form = `${base}.${rules.select(count)}`;
  return (form in en ? form : `${base}.other`) as MessageKey;
}

/** A counted phrase ("3 frames", "1 frame"), picked by the language's own plural rules. {count} holds the number. */
export function tn(base: PluralBase, count: number, params?: Params): string {
  return t(pluralKey(base, count), { count, ...params });
}

/**
 * A table of labels (a shot size's name, a project state's) whose entries read the current language each time
 * they're used: one getter per entry, so code can keep indexing the table as before.
 */
export function labels<K extends string>(keys: Readonly<Record<K, MessageKey>>): Readonly<Record<K, string>> {
  const table = {} as Record<K, string>;
  for (const id of Object.keys(keys) as K[]) {
    Object.defineProperty(table, id, { enumerable: true, get: () => t(keys[id]) });
  }
  return table;
}

/** "a, b and c" in the current language. From the translation rather than Intl, whose English adds a serial comma. */
export function list(items: readonly string[]): string {
  const last = items.at(-1);
  if (last === undefined) return '';
  if (items.length === 1) return last;
  return t('list.and', { items: items.slice(0, -1).join(t('list.separator')), last });
}

/** A date or time the way the current language writes it. */
export function formatDate(at: Date, options: Intl.DateTimeFormatOptions): string {
  return at.toLocaleString(current.dateTag, options);
}

// Errors raised below the UI (the Rust commands, the storage drivers that stand in for them) carry English text, so
// the same message reads the same from every driver and in logs. localizeError matches that text against the English
// `error.*` entries and returns the current language's version; anything else (an OS error, say) shows as it came.
let errorPatterns: { key: MessageKey; pattern: RegExp; names: string[] }[] | null = null;

function patterns(): NonNullable<typeof errorPatterns> {
  errorPatterns ??= (Object.keys(en) as MessageKey[])
    .filter((key) => key.startsWith('error.'))
    .map((key) => {
      const names: string[] = [];
      const source = en[key]
        .split(/(\{\w+\})/)
        .map((part) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1];
          if (name === undefined) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          names.push(name);
          return '(.+?)';
        })
        .join('');
      return { key, pattern: new RegExp(`^${source}$`, 's'), names };
    });
  return errorPatterns;
}

export function localizeError(message: string): string {
  for (const { key, pattern, names } of patterns()) {
    const match = pattern.exec(message);
    if (match) return t(key, Object.fromEntries(names.map((name, i) => [name, match[i + 1] ?? ''])));
  }
  return message;
}
