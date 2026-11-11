import { fsTypeFromBits, type FsType } from '../moodboards/fonts';

// Which fonts a deck's PDF may embed (5.6a, Kevin Nov 10: never embed a font whose licence bits forbid it). The bits are the
// OpenType OS/2 table's `fsType`, read here from the font file itself, so the rule holds for a bundled font and a computer's
// alike, and the tests can change a font's bits and see the rule follow.

const be16 = (data: Uint8Array, at: number): number | null => (at + 2 <= data.length ? ((data[at] ?? 0) << 8) | (data[at + 1] ?? 0) : null);
const be32 = (data: Uint8Array, at: number): number | null => {
  const high = be16(data, at);
  const low = be16(data, at + 2);
  return high === null || low === null ? null : high * 65536 + low;
};

/** The `fsType` bits of a font file (a font from a collection is read as its first face); null when it has no OS/2 table or isn't a font. */
export function fsTypeOfFont(data: Uint8Array): FsType | null {
  let base = 0;
  const tag = String.fromCharCode(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0);
  if (tag === 'ttcf') {
    const first = be32(data, 12);
    if (first === null) return null;
    base = first;
  }
  const count = be16(data, base + 4);
  if (count === null || count > 4096) return null;
  for (let i = 0; i < count; i += 1) {
    const entry = base + 12 + i * 16;
    if (String.fromCharCode(data[entry] ?? 0, data[entry + 1] ?? 0, data[entry + 2] ?? 0, data[entry + 3] ?? 0) !== 'OS/2') continue;
    const offset = be32(data, entry + 8);
    const raw = offset === null ? null : be16(data, offset + 8);
    return raw === null ? null : fsTypeFromBits(raw);
  }
  return null;
}

/** The face a font that can't be used is replaced by: the app's own. */
export const FALLBACK_FAMILY = 'Inter Tight';

/** Why a font isn't embedded, or null when it may be; with `wholeFont` when it may be embedded only whole (no subsetting). */
export type EmbedRule = { embed: true; subset: boolean } | { embed: false; reason: 'restricted' | 'bitmap' };

/**
 * The rule for a font's bits. Restricted licence (0x0002) with neither preview-and-print (0x0004) nor editable (0x0008): never
 * embedded. Bitmap-only (0x0200): never embedded (the outlines aren't for use). No-subsetting (0x0100): embedded whole.
 * A font with no OS/2 table says nothing, which is not a refusal.
 */
export function embedRule(bits: FsType | null): EmbedRule {
  if (bits === null) return { embed: true, subset: true };
  if (bits.restricted && !bits.previewPrint && !bits.editable) return { embed: false, reason: 'restricted' };
  if (bits.bitmapOnly) return { embed: false, reason: 'bitmap' };
  return { embed: true, subset: !bits.noSubsetting };
}
