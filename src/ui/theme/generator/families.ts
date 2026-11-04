// The 12 families a project theme's surfaces come from (1.14, docs/PLAN.md A). A generated theme takes only its accent
// from the image; its backgrounds, text and rules come from this table, picked by the accent's hue, so no image can
// make the app unreadable. Paper is the design kit itself and the default. The others were worked out once in OKLCH
// (light: soft tints near the paper's lightness; dark: deep tints like the kit's abyssal) and are stored as fixed
// values; themes.test.ts checks every pair of them against AA.

/** A mode's surfaces and text, in hex. The accent and the text on it are worked out per image (accent.ts). */
export interface Surfaces {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderTop: string;
  text: string;
  textMuted: string;
  textInverse: string;
}

export interface Family {
  /** As the project's `theme.family` stores it (docs/SBD_FORMAT.md): `paper`, `navy`. */
  id: string;
  /** As Settings shows it. */
  name: string;
  /** The OKLCH hue an accent snaps to this family from, in degrees. */
  hue: number;
  light: Surfaces;
  dark: Surfaces;
}

/** The design kit (design/tokens/tokens.css), light and dark. */
export const PAPER: Family = {
  id: 'paper',
  name: 'Paper',
  // The kit's own orange sits at 41°; Paper takes the oranges, Clay the brick reds beside them.
  hue: 48,
  light: { bg: '#EEE9DF', surface: '#EEE9DF', surfaceRaised: '#C9C1B1', border: '#16150F', borderTop: '#16150F', text: '#16150F', textMuted: '#5E5A52', textInverse: '#EEE9DF' },
  dark: { bg: '#1B2632', surface: '#2C3B4D', surfaceRaised: '#3A4B60', border: '#0E151C', borderTop: '#EEE9DF', text: '#EEE9DF', textMuted: '#A9B2BC', textInverse: '#1B2632' },
};

export const FAMILIES: readonly Family[] = [
  PAPER,
  {
    id: 'rose',
    name: 'Rose',
    hue: 10,
    light: { bg: '#F5E5E7', surface: '#F5E5E7', surfaceRaised: '#D7BDC0', border: '#1B1415', borderTop: '#1B1415', text: '#1B1415', textMuted: '#655658', textInverse: '#F5E5E7' },
    dark: { bg: '#301D1F', surface: '#412A2D', surfaceRaised: '#53373B', border: '#1B0D0F', borderTop: '#F1E6E8', text: '#F1E6E8', textMuted: '#BDACAE', textInverse: '#301D1F' },
  },
  {
    id: 'clay',
    name: 'Clay',
    hue: 32,
    light: { bg: '#F5E5E2', surface: '#F5E5E2', surfaceRaised: '#D7BEB8', border: '#1B1413', borderTop: '#1B1413', text: '#1B1413', textMuted: '#665754', textInverse: '#F5E5E2' },
    dark: { bg: '#301D1A', surface: '#422B26', surfaceRaised: '#533832', border: '#1B0D0B', borderTop: '#F1E7E4', text: '#F1E7E4', textMuted: '#BDADA9', textInverse: '#301D1A' },
  },
  {
    id: 'ochre',
    name: 'Ochre',
    hue: 78,
    light: { bg: '#F0E8DC', surface: '#F0E8DC', surfaceRaised: '#CFC2AF', border: '#191510', borderTop: '#191510', text: '#191510', textMuted: '#615A4E', textInverse: '#F0E8DC' },
    dark: { bg: '#2B2112', surface: '#3B2F1D', surfaceRaised: '#4B3D27', border: '#181005', borderTop: '#EEE9E1', text: '#EEE9E1', textMuted: '#B8B0A3', textInverse: '#2B2112' },
  },
  {
    id: 'sand',
    name: 'Sand',
    hue: 95,
    light: { bg: '#EDEADC', surface: '#EDEADC', surfaceRaised: '#CAC4AF', border: '#181610', borderTop: '#181610', text: '#181610', textMuted: '#5E5B4E', textInverse: '#EDEADC' },
    dark: { bg: '#272312', surface: '#37311D', surfaceRaised: '#464027', border: '#151105', borderTop: '#ECEAE1', text: '#ECEAE1', textMuted: '#B5B1A3', textInverse: '#272312' },
  },
  {
    id: 'olive',
    name: 'Olive',
    hue: 115,
    light: { bg: '#E9EBDE', surface: '#E9EBDE', surfaceRaised: '#C3C7B1', border: '#161711', borderTop: '#161711', text: '#161711', textMuted: '#5A5C50', textInverse: '#E9EBDE' },
    dark: { bg: '#222514', surface: '#31341F', surfaceRaised: '#3F422A', border: '#111306', borderTop: '#E9EBE2', text: '#E9EBE2', textMuted: '#B0B3A5', textInverse: '#222514' },
  },
  {
    id: 'sage',
    name: 'Sage',
    hue: 145,
    light: { bg: '#E2EDE2', surface: '#E2EDE2', surfaceRaised: '#B9CAB8', border: '#131813', borderTop: '#131813', text: '#131813', textMuted: '#545E54', textInverse: '#E2EDE2' },
    dark: { bg: '#1A271A', surface: '#263627', surfaceRaised: '#324633', border: '#0A150B', borderTop: '#E5ECE5', text: '#E5ECE5', textMuted: '#AAB5A9', textInverse: '#1A271A' },
  },
  {
    id: 'teal',
    name: 'Teal',
    hue: 195,
    light: { bg: '#DDEEED', surface: '#DDEEED', surfaceRaised: '#AFCBCA', border: '#101818', borderTop: '#101818', text: '#101818', textMuted: '#4E5F5E', textInverse: '#DDEEED' },
    dark: { bg: '#0F2727', surface: '#1A3737', surfaceRaised: '#244646', border: '#031515', borderTop: '#E1ECEC', text: '#E1ECEC', textMuted: '#A3B5B5', textInverse: '#0F2727' },
  },
  {
    id: 'slate',
    name: 'Slate',
    hue: 235,
    light: { bg: '#E4EBEF', surface: '#E4EBEF', surfaceRaised: '#BBC6CD', border: '#131718', borderTop: '#131718', text: '#131718', textMuted: '#565C60', textInverse: '#E4EBEF' },
    dark: { bg: '#1C2429', surface: '#293339', surfaceRaised: '#364249', border: '#0C1316', borderTop: '#E6EAED', text: '#E6EAED', textMuted: '#ABB2B7', textInverse: '#1C2429' },
  },
  {
    id: 'navy',
    name: 'Navy',
    hue: 262,
    light: { bg: '#E3EAF6', surface: '#E3EAF6', surfaceRaised: '#BAC5D8', border: '#13161C', borderTop: '#13161C', text: '#13161C', textMuted: '#555B66', textInverse: '#E3EAF6' },
    dark: { bg: '#1B2331', surface: '#283244', surfaceRaised: '#344055', border: '#0B121D', borderTop: '#E5EAF2', text: '#E5EAF2', textMuted: '#AAB1BE', textInverse: '#1B2331' },
  },
  {
    id: 'violet',
    name: 'Violet',
    hue: 295,
    light: { bg: '#EAE7F5', surface: '#EAE7F5', surfaceRaised: '#C5C1D6', border: '#16151B', borderTop: '#16151B', text: '#16151B', textMuted: '#5B5965', textInverse: '#EAE7F5' },
    dark: { bg: '#242030', surface: '#332E42', surfaceRaised: '#413C53', border: '#120F1C', borderTop: '#EAE8F1', text: '#EAE8F1', textMuted: '#B2AFBD', textInverse: '#242030' },
  },
  {
    id: 'plum',
    name: 'Plum',
    hue: 335,
    light: { bg: '#F2E5EE', surface: '#F2E5EE', surfaceRaised: '#D1BDCC', border: '#1A1418', borderTop: '#1A1418', text: '#1A1418', textMuted: '#62575F', textInverse: '#F2E5EE' },
    dark: { bg: '#2C1D29', surface: '#3D2B39', surfaceRaised: '#4D3848', border: '#180D16', borderTop: '#EFE7ED', text: '#EFE7ED', textMuted: '#BAADB6', textInverse: '#2C1D29' },
  },
];
