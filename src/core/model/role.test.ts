import { describe, expect, it } from 'vitest';
import { editAuthor } from '../../app/settings/profileStore';
import { EMPTY_PROFILE, loadSettings } from '../storage/settings';
import { initialsOf, isRole, ROLE_LABELS, ROLES } from './role';

describe('the local profile (polish C)', () => {
  it('works out initials from the first and last names', () => {
    expect(initialsOf('Kevin Matos')).toBe('KM');
    expect(initialsOf('  kevin   de la matos ')).toBe('KM');
    expect(initialsOf('Kevin')).toBe('K');
    expect(initialsOf('Ángela Núñez')).toBe('ÁN');
    expect(initialsOf('')).toBe('');
  });

  it('knows its roles by id, each with a name', () => {
    expect(isRole('dp')).toBe(true);
    expect(isRole('gaffer ')).toBe(false);
    expect(ROLES.every((role) => ROLE_LABELS[role] !== '')).toBe(true);
    expect(ROLE_LABELS.dp).toBe('Director of photography');
  });

  it('reads a saved profile, trimming it and dropping what this version doesn’t know', () => {
    const storage = (value: unknown) => ({ getItem: () => JSON.stringify({ profile: value }) });
    expect(loadSettings(storage({ name: ' Kevin Matos ', initials: 'kmx9', role: 'dp' })).profile).toEqual({ name: 'Kevin Matos', initials: 'kmx', role: 'dp', historyInitials: false });
    expect(loadSettings(storage({ name: 4, role: 'stunt double' })).profile).toEqual({ name: '', initials: '', role: null, historyInitials: false });
    expect(loadSettings(storage(null)).profile).toEqual({ name: '', initials: '', role: null, historyInitials: false });
    expect(loadSettings(storage({ name: 'Kevin', historyInitials: true })).profile.historyInitials).toBe(true);
    expect(loadSettings(storage({ name: 'Kevin', historyInitials: 'yes' })).profile.historyInitials).toBe(false);
  });

  it('signs each edit with the name, or the initials if chosen, and with no name at all as before (Kevin, Nov 5)', () => {
    const kevin = { ...EMPTY_PROFILE, name: 'Kevin Matos' };
    expect(editAuthor(kevin)).toBe('Kevin Matos');
    expect(editAuthor({ ...kevin, historyInitials: true })).toBe('KM');
    expect(editAuthor({ ...kevin, initials: 'KJM', historyInitials: true })).toBe('KJM');
    // Nothing filled in: the log's own word for no name, as every edit before names were kept.
    expect(editAuthor(EMPTY_PROFILE)).toBe('local');
    expect(editAuthor({ ...EMPTY_PROFILE, historyInitials: true })).toBe('local');
  });
});

describe('profile text as kept', () => {
  it('drops controls and direction overrides but keeps joiners, and cuts by characters, never mid-emoji', async () => {
    const { cleanProfileText } = await import('../storage/settings');
    expect(cleanProfileText('Kevin\u202E Matos\u0007', 60)).toBe('Kevin Matos');
    expect(cleanProfileText('می\u200Cخواهم', 60)).toBe('می\u200Cخواهم');
    expect(cleanProfileText(`${'a'.repeat(59)}😀😀`, 60)).toBe(`${'a'.repeat(59)}😀`);
  });
});
