import { t } from '../i18n';

// The numbers to call, by country (4.5, docs/PHASE4_DECISIONS.md decision 2; kinds and Latin America in 4.13): printed
// in the safety box of every call sheet at a location in that country.
//
// This table is meant to be edited: fork it, correct it, add your country. Each entry should be checked against the
// country's own sources before a shoot relies on it. A country that isn't here prints "check locally": the app never
// guesses (112 is not a worldwide number). A number is `emergency` (a general line: police, fire and ambulance) or
// `ambulance` (medical only, and printed as "Ambulance").

export type EmergencyKind = 'emergency' | 'ambulance';

export interface EmergencyNumber {
  kind: EmergencyKind;
  number: string;
}

const e = (number: string): EmergencyNumber => ({ kind: 'emergency', number });
const a = (number: string): EmergencyNumber => ({ kind: 'ambulance', number });

/** ISO 3166-1 alpha-2 code to the numbers to call, the first being the main one. */
const TABLE: Readonly<Record<string, readonly EmergencyNumber[]>> = {
  // 911
  US: [e('911')],
  CA: [e('911')],
  MX: [e('911')],
  PR: [e('911')],
  GU: [e('911')],
  VI: [e('911')],
  // 112: the European Union (Ireland aside, below), plus Norway, Switzerland, Iceland and India.
  AT: [e('112')],
  BE: [e('112')],
  BG: [e('112')],
  HR: [e('112')],
  CY: [e('112')],
  CZ: [e('112')],
  DK: [e('112')],
  EE: [e('112')],
  FI: [e('112')],
  FR: [e('112')],
  DE: [e('112')],
  GR: [e('112')],
  HU: [e('112')],
  IT: [e('112')],
  LV: [e('112')],
  LT: [e('112')],
  LU: [e('112')],
  MT: [e('112')],
  NL: [e('112')],
  PL: [e('112')],
  PT: [e('112')],
  RO: [e('112')],
  SK: [e('112')],
  SI: [e('112')],
  ES: [e('112')],
  SE: [e('112')],
  NO: [e('112')],
  CH: [e('112')],
  IS: [e('112')],
  IN: [e('112')],
  // Two numbers
  GB: [e('999'), e('112')],
  IE: [e('112'), e('999')],
  // One each
  AU: [e('000')],
  NZ: [e('111')],
  JP: [a('119')],
  BR: [a('192')],
  CL: [a('131')],
  PE: [a('106')],
  AR: [a('107')],
  // Latin America, each checked on Nov 10, 2026 against an official government source.
  // Ecuador: ecu911.gob.ec, Decreto 988 (the single number).
  EC: [e('911')],
  // Costa Rica: Ley 7566; mcj.go.cr's directory, poder-judicial.go.cr.
  CR: [e('911')],
  // Honduras: 911.gob.hn, Sistema Nacional de Emergencias.
  HN: [e('911')],
  // Panama: minsa.gob.pa ("el número nacional para emergencias es el 9-1-1").
  PA: [e('911')],
  // Dominican Republic: Ley 184-17, policianacional.gob.do; 911.gob.do.
  DO: [e('911')],
  // Venezuela: ven911.gob.ve (the single line since 171 was replaced).
  VE: [e('911')],
  // Colombia: policia.gov.co, funcionpublica.gov.co (Línea única de emergencias nacional 123; CRT Resolución 087 de 1997).
  CO: [e('123')],
  // El Salvador: presidencia.gob.sv and salud.gob.sv (Sistema de Emergencias Médicas 132).
  SV: [e('911'), a('132')],
  // Uruguay: montevideo.gub.uy (Policía 911, Ambulancia MSP 105).
  UY: [e('911'), a('105')],
  // Paraguay: mspbs.gov.py ("Llamá gratis al 141 ante urgencias en salud"); 911 Policía Nacional, Ley 4739.
  PY: [e('911'), a('141')],
  // Guatemala: conred.gob.gt (Bomberos Voluntarios 122, the main ambulance service; there is no single number).
  GT: [a('122')],
  // Nicaragua: minsa.gob.ni (Central de Ambulancias 102).
  NI: [a('102')],
  // Cuba: sld.cu / gob.cu (SIUM 104).
  CU: [a('104')],
  // Haiti: servicespublics.gouv.ht (Service ambulancier national 116).
  HT: [a('116')],
  // Bolivia is left out on purpose: 168 works in some departments only (minsalud.gob.bo, 2025), so it prints "check locally".
};

/** The numbers for a country code (any case), or an empty list for a country not in the table. */
export function emergencyNumbers(countryCode: string | null | undefined): readonly EmergencyNumber[] {
  if (!countryCode) return [];
  return TABLE[countryCode.trim().toUpperCase()] ?? [];
}

/**
 * The numbers as one line: "Emergency 911", "Ambulance 106", "Emergency 911 · Ambulance 141", "Emergency 999 or 112".
 * Empty for a country not in the table; the caller prints "check locally".
 */
export function emergencyText(numbers: readonly EmergencyNumber[]): string {
  const groups: { kind: EmergencyKind; list: string[] }[] = [];
  for (const { kind, number } of numbers) {
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) last.list.push(number);
    else groups.push({ kind, list: [number] });
  }
  return groups
    .map(({ kind, list }) =>
      t('emergency.group', {
        kind: t(kind === 'ambulance' ? 'emergency.ambulance' : 'emergency.emergency'),
        numbers: list.length === 2 ? t('emergency.two', { first: list[0] ?? '', second: list[1] ?? '' }) : list.join(', '),
      }),
    )
    .join(' · ');
}

/** Every country the table lists, for tests. */
export const EMERGENCY_COUNTRIES: readonly string[] = Object.keys(TABLE);
