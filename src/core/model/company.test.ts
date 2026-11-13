import { describe, expect, it } from 'vitest';
import { cleanBrandColors, cleanBrandFonts, companyProfilesOf, companyProp, logoMark, MAX_BRAND_COLORS, MAX_BRAND_FONTS, MAX_COMPANIES, profileChanged, projectCompany } from './company';

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
  brandColors: [],
  brandFonts: [],
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
      brandColors: [],
      brandFonts: [],
    });
    expect((prop as Record<string, unknown>).tax_id).toBe('X-1');
    expect(projectCompany({})).toBeNull();
  });

  it('keeps at most eight brand colours, hex only, upper case, each once, and at most three fonts (5.4)', () => {
    const nine = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999'];
    expect(cleanBrandColors(nine)).toHaveLength(MAX_BRAND_COLORS);
    expect(cleanBrandColors(['#df5e27', ' #DF5E27 ', 'DF5E27', '#12345', '#ggg111', 'red', 7, null, '#16150f'])).toEqual(['#DF5E27', '#16150F']);
    expect(cleanBrandColors('#DF5E27')).toEqual([]);
    expect(cleanBrandFonts(['Inter Tight', 'Jost', 'Inter Tight', '  ', 'Outfit', 'Bodoni Moda'])).toEqual(['Inter Tight', 'Jost', 'Outfit']);
    expect(cleanBrandFonts(['a', 'b', 'c', 'd'])).toHaveLength(MAX_BRAND_FONTS);
    expect(cleanBrandFonts([3, {}])).toEqual([]);
    // A saved profile with a bad kit reads back clean; one saved before 5.4 has none.
    const [read] = companyProfilesOf([{ ...profile, brandColors: ['#df5e27', 'nope'], brandFonts: ['Jost', 5] }]);
    expect(read?.brandColors).toEqual(['#DF5E27']);
    expect(read?.brandFonts).toEqual(['Jost']);
    const older: Record<string, unknown> = { ...profile };
    delete older.brandColors;
    delete older.brandFonts;
    expect(companyProfilesOf([older])[0]).toMatchObject({ brandColors: [], brandFonts: [] });
  });

  it('copies the brand kit into the project with the rest and tells a profile that changed its kit (5.4)', () => {
    const kit = { ...profile, brandColors: ['#DF5E27', '#16150F'], brandFonts: ['Jost'] };
    const prop = companyProp(undefined, kit, 'l1');
    expect(prop).toMatchObject({ brand_colors: ['#DF5E27', '#16150F'], brand_fonts: ['Jost'] });
    const copy = projectCompany({ company: prop });
    if (!copy) throw new Error('the copy');
    expect(copy.brandColors).toEqual(['#DF5E27', '#16150F']);
    expect(copy.brandFonts).toEqual(['Jost']);
    expect(profileChanged(copy, kit)).toBe(false);
    expect(profileChanged(copy, { ...kit, brandColors: ['#DF5E27'] })).toBe(true);
    expect(profileChanged(copy, { ...kit, brandFonts: ['Jost', 'Outfit'] })).toBe(true);
    // A copy from before 5.4 reads as none, and matches a profile with none.
    const older = projectCompany({ company: { profile_id: 'co1', name: 'Zima Blue Pictures' } });
    expect(older).toMatchObject({ brandColors: [], brandFonts: [] });
    // A copy whose stored kit was edited by hand (nine colours, a bad one) reads clean.
    const odd = projectCompany({ company: { profile_id: 'co1', brand_colors: ['#aaaaaa', 'zz', ...Array.from({ length: 9 }, (_, i) => `#00000${String(i)}`)] } });
    expect(odd?.brandColors).toHaveLength(MAX_BRAND_COLORS);
    expect(odd?.brandColors[0]).toBe('#AAAAAA');
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
