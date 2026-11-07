import { describe, expect, it } from 'vitest';
import { companyProfilesOf, companyProp, logoMark, MAX_COMPANIES, profileChanged, projectCompany } from './company';

// Company profiles (3.2): saved on this computer, copied into a project; the copy read back, and told apart from a
// profile that changed since.

const profile = {
  id: 'co1',
  name: 'Zima Blue Pictures',
  address: '12 Mott St, New York',
  phone: '+1 212 555 0100',
  email: 'hello@example.com',
  website: 'https://example.com',
  logo: 'data:image/png;base64,iVBORw0KGgo=',
};

describe('company profiles', () => {
  it('reads only well-formed profiles, each id once, at most the cap', () => {
    expect(companyProfilesOf(undefined)).toEqual([]);
    expect(companyProfilesOf([profile, { ...profile }, { name: 'no id' }, 'x'])).toEqual([profile]);
    // A logo that isn't a small PNG data URL is dropped, the rest kept.
    expect(companyProfilesOf([{ ...profile, logo: 'https://example.com/logo.png' }])[0]?.logo).toBeNull();
    const many = Array.from({ length: MAX_COMPANIES + 5 }, (_, i) => ({ ...profile, id: `c${String(i)}` }));
    expect(companyProfilesOf(many)).toHaveLength(MAX_COMPANIES);
  });

  it('copies a profile into the project, keeping fields a later version stored, and reads it back', () => {
    const prop = companyProp({ profile_id: 'old', tax_id: 'X-1' }, profile, 'logo-media');
    const copy = projectCompany({ company: prop });
    expect(copy).toEqual({
      profileId: 'co1',
      name: 'Zima Blue Pictures',
      address: '12 Mott St, New York',
      phone: '+1 212 555 0100',
      email: 'hello@example.com',
      website: 'https://example.com',
      logoId: 'logo-media',
      logoSource: logoMark(profile.logo),
    });
    expect((prop as Record<string, unknown>).tax_id).toBe('X-1');
    expect(projectCompany({})).toBeNull();
  });

  it('tells a copy apart from a profile that changed since, its logo included', () => {
    const copy = projectCompany({ company: companyProp(undefined, profile, 'l1') });
    if (!copy) throw new Error('the copy');
    expect(profileChanged(copy, profile)).toBe(false);
    // A copy that ended up with no logo in the project differs from a profile that has one: Update puts it back.
    const bare = projectCompany({ company: companyProp(undefined, profile, null) });
    expect(bare && profileChanged(bare, profile)).toBe(true);
    expect(profileChanged(copy, { ...profile, phone: '+1 212 555 0199' })).toBe(true);
    expect(profileChanged(copy, { ...profile, logo: 'data:image/png;base64,AAAA' })).toBe(true);
    expect(profileChanged(copy, { ...profile, logo: null })).toBe(true);
    expect(logoMark(null)).toBeNull();
    expect(logoMark('a')).not.toBe(logoMark('b'));
  });
});
