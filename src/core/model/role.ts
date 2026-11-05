import { labels } from '../i18n';

// The roles a person can have on a production (polish C, the local profile; a project's own "Your role" in polish 6).
// Kept by id, so a file reads the same in every language. The director and the DP approve a shot's departments
// (polish 6); people and their roles on a project arrive with Phase 3, accounts with the web companion in Phase 9.

export const ROLES = [
  'director',
  'dp',
  'producer',
  'first-ad',
  'gaffer',
  'key-grip',
  'production-designer',
  'hmu',
  'wardrobe',
  'sound',
  'editor',
  'cast',
  'client',
  'other',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = labels({
  director: 'role.director',
  dp: 'role.dp',
  producer: 'role.producer',
  'first-ad': 'role.firstAd',
  gaffer: 'role.gaffer',
  'key-grip': 'role.keyGrip',
  'production-designer': 'role.productionDesigner',
  hmu: 'role.hmu',
  wardrobe: 'role.wardrobe',
  sound: 'role.sound',
  editor: 'role.editor',
  cast: 'role.cast',
  client: 'role.client',
  other: 'role.otherRole',
});

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** "KM" for Kevin Matos: the first letter of the first and last words, as an avatar shows them. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== '');
  const first = words[0];
  const last = words.length > 1 ? words.at(-1) : undefined;
  return [...(first ? [first] : []), ...(last ? [last] : [])]
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}
