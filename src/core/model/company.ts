import type { JsonValue, Props } from './record';

// Company profiles (3.2, docs/PHASE3_DECISIONS.md 13): a production company saved once, in the app's settings on this
// computer, and attached to any project. Attaching copies its details into the project record (`company`) and its
// logo into the project as a picture, so the file carries them to another computer that has no such profile. The copy
// stays as it was until Update from profile; call sheets (Phase 4) and brand-kit cards (Phase 5) read it.

/** A company as saved in the app's settings. */
export interface CompanyProfile {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** The logo, made small (PNG, at most LOGO_EDGE on its long edge) as a data URL; null for none. */
  logo: string | null;
}

/** The fields a profile and its copy share, in the order a form shows them. */
export const COMPANY_FIELDS = ['name', 'address', 'phone', 'email', 'website'] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** A profile's logo is kept this small: enough for a call sheet's header, little in the app's settings. */
export const LOGO_EDGE = 320;
/** At most this many characters of data URL for one logo. */
export const MAX_LOGO_CHARS = 150_000;
/**
 * At most this many characters of logo across every profile: the app's settings share one small browser store with
 * the theme, the backups' numbers and the rest, which a full store would silently stop saving.
 */
export const MAX_ALL_LOGOS_CHARS = 600_000;
/** At most this many profiles are kept. */
export const MAX_COMPANIES = 20;
/** Text fields are cut to this many characters. */
export const MAX_COMPANY_TEXT = 300;

/** The company attached to a project, as its record holds it. */
export interface ProjectCompany {
  /** The profile it was copied from, on whichever computer that was. */
  profileId: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** The project's picture holding the logo; null for none. */
  logoId: string | null;
  /** The logo as it was copied, to tell whether the profile's has changed since. */
  logoSource: string | null;
}

// Cut by characters as people count them, as the profile's text is cleaned when saved, so it reads back the same.
const text = (value: unknown, max = MAX_COMPANY_TEXT): string => (typeof value === 'string' ? Array.from(value).slice(0, max).join('') : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLogo = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= MAX_LOGO_CHARS;

/** A profile as saved, or null if it isn't one. */
export function companyProfileOf(value: unknown): CompanyProfile | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
  return {
    id: value.id,
    name: text(value.name),
    address: text(value.address),
    phone: text(value.phone),
    email: text(value.email),
    website: text(value.website),
    logo: isLogo(value.logo) ? value.logo : null,
  };
}

/** The profiles as saved, each one checked, at most MAX_COMPANIES, no id twice. */
export function companyProfilesOf(value: unknown): CompanyProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): CompanyProfile[] => {
    const profile = companyProfileOf(item);
    if (!profile || seen.has(profile.id)) return [];
    seen.add(profile.id);
    return [profile];
  }).slice(0, MAX_COMPANIES);
}

/** A short, stable mark of a logo's data, to see whether it changed without keeping it twice in the project. */
export function logoMark(logo: string | null): string | null {
  if (logo === null) return null;
  // FNV-1a over the text: not for security, only to tell two logos apart.
  let hash = 0x811c9dc5;
  for (let i = 0; i < logo.length; i += 1) {
    hash ^= logo.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${String(logo.length)}-${hash.toString(16)}`;
}

/** The project's company, or null when none is attached. */
export function projectCompany(props: Props | undefined): ProjectCompany | null {
  const stored = props?.company;
  if (!isRecord(stored) || typeof stored.profile_id !== 'string') return null;
  return {
    profileId: stored.profile_id,
    name: text(stored.name),
    address: text(stored.address),
    phone: text(stored.phone),
    email: text(stored.email),
    website: text(stored.website),
    logoId: typeof stored.logo_id === 'string' ? stored.logo_id : null,
    logoSource: typeof stored.logo_source === 'string' ? stored.logo_source : null,
  };
}

/**
 * The `company` prop for a profile copied into a project, keeping any field a later version stored there (CLAUDE.md:
 * changing a record never drops its props), but for those this one sets.
 */
export function companyProp(stored: JsonValue | undefined, profile: CompanyProfile, logoId: string | null): JsonValue {
  const kept = isRecord(stored) ? (stored as Record<string, JsonValue>) : {};
  return {
    ...kept,
    profile_id: profile.id,
    name: profile.name,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    logo_id: logoId,
    logo_source: logoMark(profile.logo),
  };
}

/** Whether the profile has changed since it was copied into the project (Update from profile has something to do). */
export function profileChanged(copy: ProjectCompany, profile: CompanyProfile): boolean {
  return COMPANY_FIELDS.some((field) => copy[field] !== profile[field]) || copy.logoSource !== logoMark(profile.logo);
}
