import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { JsonValue, SbdRecord } from '../model/record';
import { cleanText, readSuggestion, reviewSuggestion } from '../model/suggestion';
import { MAX_CHANGE_FILE_BYTES, MAX_SUGGESTION_BYTES, readChangeFile, refusalWords, type ChangeFileRead, type ChangeFileRefusal } from './changeFile';

// The change file's reader (7.1): bytes in, a checked file or a refusal out. A change file is untrusted input, so every
// refusal is here, and every pass that keeps what it can't use. Made-up projects and people only: "Harbor Lights",
// Robin Vale.

const PROJECT = '0b6e2d0a-3f5c-4d8e-9c1a-7e2f4b5a6c3d';
const FILE = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11';
const S1 = 'f2b7a1c0-1111-4c47-9a7e-2b1f0c6e9a11';
const S2 = 'f2b7a1c0-2222-4c47-9a7e-2b1f0c6e9a11';

type Json = { [key: string]: JsonValue };

const suggestion = (extra: Json = {}): Json => ({
  id: S1,
  kind: 'trash',
  target: { id: 'b', type: 'shot', label: 'SC 04 · 4B', updated_at: '2026-11-20T17:41:09.000Z' },
  author: 'r1',
  created_at: '2026-11-21T09:10:31.000Z',
  note: 'We have this in 4A.',
  data: {},
  ...extra,
});

const changeFile = (extra: Json = {}): Json => ({
  format: 'storiiboard.changes',
  version: 1,
  id: FILE,
  project_id: PROJECT,
  project_name: 'Harbor Lights',
  created_by: 'mcp',
  created_at: '2026-11-21T09:12:00.000Z',
  people: [{ id: 'r1', name: 'Robin Vale', role: 'dp', person_id: 'robin', phone: '555-0100', email: 'robin@example.test' }],
  suggestions: [suggestion()],
  ...extra,
});

const bytes = (value: JsonValue | string): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const read = (value: JsonValue | string): ChangeFileRead => readChangeFile(bytes(value), PROJECT);
const refusal = (value: JsonValue | string): ChangeFileRefusal | null => {
  const got = read(value);
  return got.ok ? null : got.refusal;
};
const passed = (value: JsonValue | string) => {
  const got = read(value);
  if (!got.ok) throw new Error(`refused: ${JSON.stringify(got.refusal)}`);
  return got.file;
};

beforeEach(() => {
  setLocale('en');
});

describe('a change file refused whole (7.1)', () => {
  it('past 5 MB, even by one byte', () => {
    const big = new Uint8Array(MAX_CHANGE_FILE_BYTES + 1).fill(0x20);
    expect(readChangeFile(big, PROJECT)).toEqual({ ok: false, refusal: { kind: 'too_large' } });
  });

  it('not UTF-8, not JSON, or not an object', () => {
    expect(readChangeFile(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), PROJECT)).toEqual({ ok: false, refusal: { kind: 'not_text' } });
    expect(refusal('{"format": "storiiboard.changes",')).toEqual({ kind: 'not_json' });
    expect(refusal('')).toEqual({ kind: 'not_json' });
    expect(refusal([changeFile()])).toEqual({ kind: 'not_change_file' });
    expect(refusal('"storiiboard.changes"')).toEqual({ kind: 'not_change_file' });
  });

  it('nested too deep, counted before it is parsed, with brackets in strings left out', () => {
    let deep: JsonValue = 1;
    for (let i = 0; i < 20; i += 1) deep = [deep];
    expect(refusal(changeFile({ suggestions: [suggestion({ data: { props: { x: deep } } })] }))).toEqual({ kind: 'too_deep' });
    // A million brackets never reach JSON.parse.
    expect(refusal('['.repeat(1_000_000))).toEqual({ kind: 'too_deep' });
    // Brackets inside a string, escaped quotes too, aren't nesting.
    expect(passed(changeFile({ suggestions: [suggestion({ note: `[[[[[[[[[[[[[[[[[[[[ \\" {{{{{{{{{{{{{{{{{{{{` })] })).suggestions).toHaveLength(1);
  });

  it('of another format, a bad version or a newer one', () => {
    expect(refusal(changeFile({ format: 'storiiboard-project' }))).toEqual({ kind: 'not_change_file' });
    expect(refusal(changeFile({ format: undefined as unknown as JsonValue }))).toEqual({ kind: 'not_change_file' });
    expect(refusal(changeFile({ version: 2 }))).toEqual({ kind: 'newer_version' });
    expect(refusal(changeFile({ version: '1' }))).toEqual({ kind: 'bad_field', at: { in: 'file', field: 'version' } });
    expect(refusal(changeFile({ version: 0.5 }))).toEqual({ kind: 'bad_field', at: { in: 'file', field: 'version' } });
    expect(refusalWords({ kind: 'newer_version' })).toBe('This change file was made by a newer Storiiboard. Update Storiiboard to bring it in.');
  });

  it('for another project, saying its name as text', () => {
    const other = refusal(changeFile({ project_id: '6f1c0d2e-8a4b-4c3d-9e2f-1a0b9c8d7e6f', project_name: 'Saltmarsh‮' }));
    expect(other).toEqual({ kind: 'other_project', projectName: 'Saltmarsh' });
    expect(refusalWords(other ?? { kind: 'not_json' })).toBe('This change file is for another project, Saltmarsh.');
    expect(refusalWords({ kind: 'other_project', projectName: '' })).toBe('This change file is for another project.');
    expect(refusal(changeFile({ project_id: 7 }))).toEqual({ kind: 'bad_field', at: { in: 'file', field: 'project_id' } });
  });

  it('without a lowercase UUID for its id, or for a suggestion’s, or with one twice', () => {
    expect(refusal(changeFile({ id: 'not-an-id' }))).toEqual({ kind: 'bad_field', at: { in: 'file', field: 'id' } });
    expect(refusal(changeFile({ id: FILE.toUpperCase() }))).toEqual({ kind: 'bad_field', at: { in: 'file', field: 'id' } });
    expect(refusal(changeFile({ suggestions: [suggestion({ id: '__proto__' })] }))).toEqual({ kind: 'bad_field', at: { in: 'suggestion', position: 1 } });
    expect(refusal(changeFile({ suggestions: [suggestion(), suggestion()] }))).toEqual({ kind: 'bad_field', at: { in: 'suggestion', position: 2 } });
    expect(refusal(changeFile({ suggestions: [suggestion(), 'trash'] }))).toEqual({ kind: 'bad_field', at: { in: 'suggestion', position: 2 } });
    expect(refusal(changeFile({ suggestions: {} }))).toEqual({ kind: 'bad_field', at: { in: 'file', field: 'suggestions' } });
    expect(refusal(changeFile({ people: [{ name: 'Robin Vale' }] }))).toEqual({ kind: 'bad_field', at: { in: 'person', position: 1 } });
  });

  it('with more than 2,000 suggestions or 50 people', () => {
    const many = Array.from({ length: 2001 }, (_, i) => suggestion({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    expect(refusal(changeFile({ suggestions: many }))).toEqual({ kind: 'too_many', what: 'suggestions' });
    expect(passed(changeFile({ suggestions: many.slice(0, 2000) })).suggestions).toHaveLength(2000);
    const people = Array.from({ length: 51 }, (_, i) => ({ id: `r${String(i)}`, name: 'Robin Vale', role: 'dp' }));
    expect(refusal(changeFile({ people }))).toEqual({ kind: 'too_many', what: 'people' });
  });

  it('with a string over its bound, wherever it is', () => {
    const long = (n: number) => 'x'.repeat(n);
    expect(refusal(changeFile({ created_by: long(101) }))).toEqual({ kind: 'too_long', at: { in: 'file', field: 'created_by' } });
    expect(refusal(changeFile({ people: [{ id: 'r1', name: long(101) }] }))).toEqual({ kind: 'too_long', at: { in: 'person', position: 1 } });
    expect(refusal(changeFile({ people: [{ id: 'r1', name: 'Robin', role: long(41) }] }))).toEqual({ kind: 'too_long', at: { in: 'person', position: 1 } });
    expect(refusal(changeFile({ suggestions: [suggestion({ note: long(2001) })] }))).toEqual({ kind: 'too_long', at: { in: 'suggestion', position: 1 } });
    expect(refusal(changeFile({ suggestions: [suggestion({ target: { type: 'shot', label: long(201) } })] }))).toEqual({ kind: 'too_long', at: { in: 'suggestion', position: 1 } });
    expect(refusal(changeFile({ suggestions: [suggestion({ kind: long(41) })] }))).toEqual({ kind: 'too_long', at: { in: 'suggestion', position: 1 } });
    // Any other string, in data or a field this version doesn't know, and any key.
    expect(refusal(changeFile({ suggestions: [suggestion({ data: { props: { action: long(10_001) } } })] }))).toEqual({ kind: 'too_long', at: { in: 'suggestion', position: 1 } });
    expect(refusal(changeFile({ later: long(10_001) }))).toEqual({ kind: 'too_long', at: { in: 'file', field: null } });
    expect(refusal(changeFile({ suggestions: [suggestion({ data: { props: { [long(101)]: 1 } } })] }))?.kind).toBe('too_long');
    // At the bound, it passes.
    expect(passed(changeFile({ suggestions: [suggestion({ note: long(2000) })] })).suggestions).toHaveLength(1);
    expect(refusalWords({ kind: 'too_long', at: { in: 'suggestion', position: 1 } })).toBe('This change file wasn’t brought in: in suggestion 1, a field is too long.');
  });

  it('names a field by its position, never by the key the file wrote (round 2)', () => {
    const key = '<b>Robin‮Vale</b>';
    const bad = refusal(changeFile({ suggestions: [suggestion(), suggestion({ id: S2, [key]: 'x'.repeat(10_001) })] }));
    expect(bad).toEqual({ kind: 'too_long', at: { in: 'suggestion', position: 2 } });
    const words = refusalWords(bad ?? { kind: 'not_json' });
    expect(words).toBe('This change file wasn’t brought in: in suggestion 2, a field is too long.');
    expect(words).not.toContain('Robin');
    const top = refusal(changeFile({ [key]: 'x'.repeat(10_001) }));
    expect(top).toEqual({ kind: 'too_long', at: { in: 'file', field: null } });
    expect(refusalWords(top ?? { kind: 'not_json' })).toBe('This change file wasn’t brought in: a field is too long.');
    expect(refusalWords({ kind: 'bad_field', at: { in: 'person', position: 3 } })).toBe('This change file wasn’t brought in: in person 3, a field isn’t as the format says.');
    expect(refusalWords({ kind: 'bad_field', at: { in: 'file', field: 'version' } })).toBe('This change file wasn’t brought in: version isn’t as the format says.');
    // A target's field the file named: by position too.
    expect(refusalWords(refusal(changeFile({ suggestions: [suggestion({ target: { type: 'shot', label: 'x', [key]: 1 }, [`target_${key}`]: 2 })] })) ?? { kind: 'not_json' })).not.toContain('Robin');
  });

  it('with a suggestion over 256 KB as JSON, a bound chosen to fit two full fields with their before (round 3)', () => {
    expect(MAX_SUGGESTION_BYTES).toBe(256 * 1024);
    // Ten fields of 10,000 three-byte characters: each under every string's bound, over 256 KB together.
    const full = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${String(i)}`, '中'.repeat(10_000)]));
    const big = suggestion({ id: S2, kind: 'update', data: { props: full(5), before: full(5) } });
    expect(new TextEncoder().encode(JSON.stringify(big)).byteLength).toBeGreaterThan(MAX_SUGGESTION_BYTES);
    expect(refusal(changeFile({ suggestions: [suggestion(), big] }))).toEqual({ kind: 'suggestion_too_large', position: 2 });
    expect(refusalWords({ kind: 'suggestion_too_large', position: 2 })).toBe('This change file wasn’t brought in: suggestion 2 is larger than 256 KB.');
    // Two full fields with their before, in a script of three bytes a character: it passes.
    const two = suggestion({ id: S2, kind: 'update', data: { props: full(2), before: full(2) } });
    expect(new TextEncoder().encode(JSON.stringify(two)).byteLength).toBeGreaterThan(64 * 1024);
    expect(passed(changeFile({ suggestions: [two] })).suggestions).toHaveLength(1);
  });

  it('when a suggestion sets one of the record’s own props, which only the app writes', () => {
    for (const prop of ['status', 'source', 'change_file_id', 'decided_by', 'decided_at', 'created_id', 'after_suggestion', 'target_id', 'suggested_at']) {
      expect(refusal(changeFile({ suggestions: [suggestion({ [prop]: 'approved' })] }))).toEqual({ kind: 'bad_field', at: { in: 'suggestion', position: 1 } });
    }
    // A target's unknown field can't land on one either.
    expect(refusal(changeFile({ suggestions: [suggestion({ target: { type: 'shot', label: 'x', foo: 1 }, target_foo: 2 })] }))).toEqual({ kind: 'bad_field', at: { in: 'suggestion', position: 1 } });
  });
});

describe('a change file brought in (7.1)', () => {
  it('maps each suggestion onto a pending suggestion record, its author with no contact detail', () => {
    const file = passed(changeFile());
    expect(file).toMatchObject({ id: FILE, projectId: PROJECT, createdBy: 'mcp' });
    expect(file.suggestions).toEqual([
      {
        id: S1,
        props: {
          kind: 'trash',
          target_id: 'b',
          target_type: 'shot',
          target_label: 'SC 04 · 4B',
          target_updated_at: '2026-11-20T17:41:09.000Z',
          author: { name: 'Robin Vale', role: 'dp', person_id: 'robin' },
          suggested_at: '2026-11-21T09:10:31.000Z',
          note: 'We have this in 4A.',
          data: {},
          status: 'pending',
          source: 'mcp',
          change_file_id: FILE,
        },
      },
    ]);
    expect(JSON.stringify(file)).not.toContain('555-0100');
    expect(JSON.stringify(file)).not.toContain('example.test');
    // From the web or by hand, the source is change_file.
    expect(passed(changeFile({ created_by: 'web' })).suggestions[0]?.props.source).toBe('change_file');
    expect(passed(changeFile({ created_by: undefined as unknown as JsonValue })).suggestions[0]?.props.source).toBe('change_file');
  });

  it('names a create’s parent create in after_suggestion', () => {
    const scene = suggestion({ id: S1, kind: 'create', target: { type: 'scene', label: 'New scene' }, data: { type: 'scene', parent_id: PROJECT, after_id: null, props: {} } });
    const frame = suggestion({ id: S2, kind: 'create', target: { type: 'shot', label: 'New frame' }, data: { type: 'shot', parent_id: S1, after_id: null, props: {} } });
    const file = passed(changeFile({ suggestions: [scene, frame] }));
    expect(file.suggestions[0]?.props.after_suggestion).toBeUndefined();
    expect(file.suggestions[1]?.props.after_suggestion).toBe(S1);
  });

  it('keeps an unknown kind and an unknown field, flagged as 7.0’s reader reads them', () => {
    const file = passed(
      changeFile({
        later_field: { a: 1 },
        suggestions: [suggestion({ kind: 'restore', mood: 'warm', target: { id: 'b', type: 'shot', label: '4B', seen_in: 'review 3' } })],
      }),
    );
    const props = file.suggestions[0]?.props ?? {};
    expect(props.kind).toBe('restore');
    expect(props.mood).toBe('warm');
    expect(props.target_seen_in).toBe('review 3');
    // The file's own unknown fields aren't stored: the file is never changed, so they stay in it.
    expect(props.later_field).toBeUndefined();
    const record: SbdRecord = { id: S1, type: 'suggestion', parentId: PROJECT, sortKey: 'V', props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' };
    const read = readSuggestion(record);
    expect(read.kind).toBeNull();
    expect(read.kindName).toBe('restore');
    expect(read.unknown).toEqual(expect.arrayContaining(['mood', 'target_seen_in']));
    const review = reviewSuggestion({ [S1]: record }, PROJECT, S1);
    expect(review?.canApply).toBe(false);
    expect(review?.flags).toEqual(expect.arrayContaining([{ kind: 'newer', what: 'kind', name: 'restore' }]));
  });

  it('lets __proto__ and constructor reach nothing', () => {
    const text = JSON.stringify(changeFile()).replace(
      '"data":{}',
      '"data":{"props":{"__proto__":{"polluted":true}}},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}',
    );
    expect(text).toContain('"__proto__":{"polluted":true},"constructor"');
    const file = passed(text);
    const props = file.suggestions[0]?.props ?? {};
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(Object.hasOwn(props, '__proto__')).toBe(false);
    // constructor is kept as data, an own field like any unknown one, and flagged; it reaches no prototype.
    expect(Object.hasOwn(props, 'constructor')).toBe(true);
    expect(JSON.parse(JSON.stringify(props.constructor))).toEqual({ prototype: { polluted: true } });
    // Inside data it stays the data it is, an own key, as stored JSON keeps it.
    expect(JSON.stringify(props.data)).toBe('{"props":{"__proto__":{"polluted":true}}}');
    // A people entry or a target named __proto__ is data too.
    const odd = passed(changeFile({ people: [{ id: '__proto__', name: 'Robin Vale', role: 'dp' }], suggestions: [suggestion({ author: '__proto__' })] }));
    expect(odd.suggestions[0]?.props.author).toEqual({ name: 'Robin Vale', role: 'dp' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('keeps text with HTML and control characters as the text it is, and 7.0’s reader shows it clean', () => {
    const note = '<img src=x onerror=alert(1)>\u0007 Tighter‮';
    const file = passed(changeFile({ suggestions: [suggestion({ note, target: { id: 'b', type: 'shot', label: '<b>4B</b>' } })] }));
    const props = file.suggestions[0]?.props ?? {};
    expect(props.note).toBe(note);
    const read = readSuggestion({ id: S1, type: 'suggestion', parentId: PROJECT, sortKey: 'V', props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' });
    expect(read.note).toBe('<img src=x onerror=alert(1)> Tighter');
    expect(read.targetLabel).toBe('<b>4B</b>');
  });

  it('brings in a suggestion 7.0’s reader can’t read, flagged as it reads', () => {
    const file = passed(changeFile({ suggestions: [suggestion({ kind: 'update', data: 'not an object' })] }));
    const props = file.suggestions[0]?.props ?? {};
    const record: SbdRecord = { id: S1, type: 'suggestion', parentId: PROJECT, sortKey: 'V', props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' };
    expect(reviewSuggestion({ [S1]: record }, PROJECT, S1)?.flags).toEqual(expect.arrayContaining([{ kind: 'invalid', field: 'data', problem: 'type' }]));
  });

  it('says each refusal in Spanish too', () => {
    setLocale('es');
    expect(refusalWords({ kind: 'other_project', projectName: 'Saltmarsh' })).toBe('Este archivo de cambios es de otro proyecto, Saltmarsh.');
    expect(refusalWords({ kind: 'too_large' })).toBe('Este archivo de cambios pesa más de 5 MB, así que no se incorporó.');
    expect(refusalWords({ kind: 'newer_version' })).toBe('Este archivo de cambios lo hizo un Storiiboard más reciente. Actualiza Storiiboard para incorporarlo.');
    expect(refusalWords({ kind: 'bad_field', at: { in: 'suggestion', position: 12 } })).toBe('Este archivo de cambios no se incorporó: en la sugerencia 12, un campo no sigue el formato.');
  });

  it('shows text with format characters and line separators left out, never as a lookalike (round 2)', () => {
    expect(cleanText('Robin​Vale', 100)).toBe('RobinVale');
    expect(cleanText('﻿Robin‍ Vale⁠', 100)).toBe('Robin Vale');
    expect(cleanText('Robin\u{E0041}\u{E0042} Vale', 100)).toBe('Robin Vale');
    expect(cleanText('Robin Vale ', 100)).toBe('RobinVale');
    expect(cleanText('Robin \nVale', 100, true)).toBe('Robin\nVale');
    const file = passed(changeFile({ people: [{ id: 'r1', name: 'Robin​Vale', role: 'dp' }] }));
    const props = file.suggestions[0]?.props ?? {};
    const record: SbdRecord = { id: S1, type: 'suggestion', parentId: PROJECT, sortKey: 'V', props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' };
    expect(readSuggestion(record).author.name).toBe('RobinVale');
  });
});
