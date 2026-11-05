import { describe, expect, it } from 'vitest';
import { loadSettings } from '../storage/settings';
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
    expect(loadSettings(storage({ name: ' Kevin Matos ', initials: 'kmx9', role: 'dp' })).profile).toEqual({ name: 'Kevin Matos', initials: 'kmx', role: 'dp' });
    expect(loadSettings(storage({ name: 4, role: 'stunt double' })).profile).toEqual({ name: '', initials: '', role: null });
    expect(loadSettings(storage(null)).profile).toEqual({ name: '', initials: '', role: null });
  });
});
