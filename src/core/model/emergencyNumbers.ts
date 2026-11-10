// The number to call for an ambulance, by country (4.5, docs/PHASE4_DECISIONS.md decision 2): printed in the safety box
// of every call sheet at a location in that country.
//
// This table is meant to be edited: fork it, correct it, add your country. Each entry should be checked against the
// country's own sources before a shoot relies on it. A country that isn't here prints "check locally": the app never
// guesses (112 is not a worldwide number).

/** ISO 3166-1 alpha-2 code to the numbers to call, the first being the main one. */
const TABLE: Readonly<Record<string, readonly string[]>> = {
  // 911
  US: ['911'],
  CA: ['911'],
  MX: ['911'],
  PR: ['911'],
  GU: ['911'],
  VI: ['911'],
  // 112: the European Union (Ireland aside, below), plus Norway, Switzerland, Iceland and India.
  AT: ['112'],
  BE: ['112'],
  BG: ['112'],
  HR: ['112'],
  CY: ['112'],
  CZ: ['112'],
  DK: ['112'],
  EE: ['112'],
  FI: ['112'],
  FR: ['112'],
  DE: ['112'],
  GR: ['112'],
  HU: ['112'],
  IT: ['112'],
  LV: ['112'],
  LT: ['112'],
  LU: ['112'],
  MT: ['112'],
  NL: ['112'],
  PL: ['112'],
  PT: ['112'],
  RO: ['112'],
  SK: ['112'],
  SI: ['112'],
  ES: ['112'],
  SE: ['112'],
  NO: ['112'],
  CH: ['112'],
  IS: ['112'],
  IN: ['112'],
  // Two numbers
  GB: ['999', '112'],
  IE: ['112', '999'],
  // One each
  AU: ['000'],
  NZ: ['111'],
  JP: ['119'],
  BR: ['192'],
  CO: ['123'],
  CL: ['131'],
  PE: ['106'],
  AR: ['107'],
};

/** The numbers for a country code (any case), or an empty list for a country not in the table. */
export function emergencyNumbers(countryCode: string | null | undefined): readonly string[] {
  if (!countryCode) return [];
  return TABLE[countryCode.trim().toUpperCase()] ?? [];
}

/** Every country the table lists, for tests. */
export const EMERGENCY_COUNTRIES: readonly string[] = Object.keys(TABLE);
