import { t } from '../i18n';

// Camera bodies and recording modes the Gear tile offers (6.1, docs/PHASE6_DECISIONS.md 4). Short on purpose (Kevin):
// each entry is from the maker's own spec page, named in `source`, so a figure can be checked against where it came
// from. Never add one from memory. Picking an entry fills a body's mode name, width and height, which stay editable,
// so a mode missing here is typed by hand. Camera and mode names are proper names, never translated; the phones entry
// is the one exception, worded in the app's language.

export interface SensorMode {
  id: string;
  /** The maker and model, as the maker writes it; null for the phones entry, which reads in the app's language. */
  camera: string | null;
  /** The mode's name as stored on the body (`sensor_mode`). The phones entry stores its English words. */
  mode: string;
  widthMm: number;
  heightMm: number;
  /** The maker's own page the figures come from. */
  source: string;
  /** Figures not yet read off the maker's page: to be confirmed. */
  unchecked?: boolean;
  /** Focal lengths on this body are full-frame equivalents (a phone): sets `focal_equivalent`. */
  focalEquivalent?: boolean;
}

/** The stored mode name of the phones entry; shown in the app's language (modeLabel). */
export const EQUIVALENT_MODE = 'Focal lengths as full-frame equivalents';

const ALEXA_35 = 'https://www.arri.com/en/camera-systems/cameras/alexa-35';
const MINI_LF = 'https://www.arri.com/en/camera-systems/cameras/alexa-mini-lf';
const BMPCC = 'https://www.blackmagicdesign.com/products/blackmagicpocketcinemacamera/techspecs/W-CIN-12';

export const SENSOR_MODES: readonly SensorMode[] = [
  // ARRI's ALEXA 35 page: https://www.arri.com/en/camera-systems/cameras/alexa-35
  { id: 'alexa35-46k-og', camera: 'ARRI ALEXA 35', mode: '4.6K 3:2 Open Gate', widthMm: 27.99, heightMm: 19.22, source: ALEXA_35 },
  { id: 'alexa35-46k-169', camera: 'ARRI ALEXA 35', mode: '4.6K 16:9', widthMm: 28.0, heightMm: 15.7, source: ALEXA_35 },
  { id: 'alexa35-4k-169', camera: 'ARRI ALEXA 35', mode: '4K 16:9', widthMm: 24.9, heightMm: 14.0, source: ALEXA_35 },
  // ARRI's ALEXA Mini LF page: https://www.arri.com/en/camera-systems/cameras/alexa-mini-lf
  { id: 'minilf-45k-og', camera: 'ARRI ALEXA Mini LF', mode: '4.5K LF 3:2 Open Gate', widthMm: 36.7, heightMm: 25.54, source: MINI_LF },
  { id: 'minilf-43k-169', camera: 'ARRI ALEXA Mini LF', mode: '4.3K LF 16:9', widthMm: 35.64, heightMm: 20.05, source: MINI_LF },
  { id: 'minilf-38k-169', camera: 'ARRI ALEXA Mini LF', mode: '3.8K LF 16:9', widthMm: 31.68, heightMm: 17.82, source: MINI_LF },
  // RED's KOMODO 6K tech specs: https://docs.red.com/955-0196_v1.6/Content/A_TechSpecs/Specs_KOMODO_6K.htm
  {
    id: 'komodo-6k-179',
    camera: 'RED KOMODO 6K',
    mode: '6K 17:9',
    widthMm: 27.03,
    heightMm: 14.26,
    source: 'https://docs.red.com/955-0196_v1.6/Content/A_TechSpecs/Specs_KOMODO_6K.htm',
  },
  // Blackmagic's Pocket Cinema Camera tech specs: https://www.blackmagicdesign.com/products/blackmagicpocketcinemacamera/techspecs/W-CIN-12
  { id: 'bmpcc6k-6k', camera: 'Blackmagic Pocket Cinema Camera 6K', mode: '6K (Super 35)', widthMm: 23.1, heightMm: 12.99, source: BMPCC },
  { id: 'bmpcc4k-4k', camera: 'Blackmagic Pocket Cinema Camera 4K', mode: '4K (Four Thirds)', widthMm: 18.96, heightMm: 10, source: BMPCC },
  // Kevin's own figures (Nov 3 and Nov 13): Sony's site could not be read when the table was made, so Kevin confirms
  // them against Sony's spec page for the FX3 before `unchecked` comes off.
  { id: 'fx3-ff-169', camera: 'Sony FX3', mode: 'Full frame 16:9', widthMm: 35.6, heightMm: 20.0, source: 'Kevin’s figures, Nov 3 and Nov 13 (to check against Sony’s FX3 spec page)', unchecked: true },
  // The 35 mm still frame, 36 × 24 mm: what a phone's "equivalent" focal lengths are given against.
  { id: 'equivalent', camera: null, mode: EQUIVALENT_MODE, widthMm: 36, heightMm: 24, source: 'The 35 mm still frame (36 × 24 mm)', focalEquivalent: true },
];

/** The camera's name as the choice shows it. */
export const cameraLabel = (entry: SensorMode): string => entry.camera ?? t('sensorModes.phone');

/** A stored mode name as shown: the phones entry's words in the app's language, any other as typed. */
export const modeLabel = (mode: string): string => (mode === EQUIVALENT_MODE ? t('sensorModes.equivalent') : mode);

/** The entry a body's mode, width and height match exactly, or null when any was typed over. */
export function matchingMode(mode: string, widthMm: number | null, heightMm: number | null): SensorMode | null {
  return SENSOR_MODES.find((entry) => entry.mode === mode && entry.widthMm === widthMm && entry.heightMm === heightMm) ?? null;
}
