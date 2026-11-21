import { afterEach, describe, expect, it } from 'vitest';
import { list, setLocale, t } from '../i18n';
import { ASSISTANT_SCOPE, SCOPE_ROWS, scopeField, scopeType, scopeWords } from './suggestionScope';

// The scope table (7.0, departments decision 5): one table of rows; the assistant's row is Phase 7's list, and its
// words are made from the table, so they name every allowed field and nothing else.

afterEach(() => {
  setLocale('en');
});

describe('the assistant’s row', () => {
  it('allows frames, scenes and notes; a day’s frames, order and gear list; a call sheet’s notes and calls', () => {
    const allowed = Object.fromEntries(Object.entries(ASSISTANT_SCOPE.types).map(([type, entry]) => [type, { kinds: [...entry.kinds], fields: Object.keys(entry.fields) }]));
    expect(allowed).toEqual({
      shot: {
        kinds: ['trash', 'update', 'create', 'reorder'],
        fields: ['title', 'size', 'lens_mm', 't_stop', 'support', 'height', 'move', 'status', 'action', 'dialogue', 'location_id', 'shoot_day_id', 'gear_ids'],
      },
      scene: { kinds: ['trash', 'update', 'create'], fields: ['name', 'int_ext', 'day_night', 'location_id', 'page_eighths', 'character_ids'] },
      note: { kinds: ['trash', 'update', 'create', 'reorder'], fields: ['text'] },
      shoot_day: { kinds: ['update'], fields: ['gear_ids', 'call_time', 'wrap_time'] },
      callsheet: { kinds: ['update'], fields: ['notes', 'safety_notes', 'department_calls', 'person_times'] },
    });
    expect(Object.keys(SCOPE_ROWS)).toEqual(['assistant']);
  });

  it('never names contact details, numbers, approvals, pictures, sketches, settings or the Trash', () => {
    const never = ['phone', 'email', 'address', 'contact_phone', 'contact_email', 'number', 'numbers_locked', 'department_approvals', 'department_status', 'media_id', 'crop', 'clip', 'custom', 'trashed_at', 'setup_id', 'lens_id'];
    for (const entry of Object.values(ASSISTANT_SCOPE.types)) for (const field of never) expect(scopeField(entry, field)).toBeNull();
    for (const type of ['project', 'person', 'media', 'stroke', 'location', 'gear_item', 'plan_item', 'settings_preset']) expect(scopeType(ASSISTANT_SCOPE, type)).toBeNull();
  });

  it('looks up no key of Object’s own', () => {
    expect(scopeType(ASSISTANT_SCOPE, '__proto__')).toBeNull();
    expect(scopeType(ASSISTANT_SCOPE, 'constructor')).toBeNull();
    const shot = scopeType(ASSISTANT_SCOPE, 'shot');
    expect(shot && scopeField(shot, '__proto__')).toBeNull();
    expect(shot && scopeField(shot, 'toString')).toBeNull();
  });
});

describe('What the assistant can suggest, in words', () => {
  it('names every allowed field and nothing else, from the table', () => {
    const words = scopeWords(ASSISTANT_SCOPE);
    expect(words.title).toBe('What the assistant can suggest');
    expect(words.lines).toEqual([
      'Frames: move to the Trash, change, add and reorder. Fields: title, size, lens, T-stop, support, height, move, status, action, dialogue, location, shoot day and gear.',
      'Scenes: move to the Trash, change and add. Fields: name, INT/EXT, time of day, location, length and characters.',
      'Notes: move to the Trash, change, add and reorder. Fields: text.',
      'Shoot days: change. Fields: gear, call and wrap.',
      'Call sheets: change. Fields: general notes, safety notes, department calls and times.',
    ]);
    // Each line's fields are exactly its type's, by the table's own labels.
    Object.values(ASSISTANT_SCOPE.types).forEach((entry, i) => {
      const fields = list(Object.values(entry.fields).map((field) => t(field.label)));
      expect(words.lines[i]?.endsWith(`Fields: ${fields}.`)).toBe(true);
    });
    const all = words.lines.join(' ');
    for (const left of [t('history.field.phone'), t('history.field.email'), t('history.field.number'), t('history.field.custom'), t('history.field.mediaId')]) {
      expect(all.includes(` ${left},`) || all.includes(` ${left}.`)).toBe(false);
    }
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    const words = scopeWords(ASSISTANT_SCOPE);
    expect(words.title).toBe('Lo que el asistente puede sugerir');
    expect(words.lines[3]).toBe('Días de rodaje: cambiar. Campos: equipamiento, llamado y fin de jornada.');
  });
});
