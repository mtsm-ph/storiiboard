import { describe, expect, it } from 'vitest';
import { aseBytes } from './swatchesAse';

// The .ase writer, byte for byte (5.6b): "ASEF", version 1.0, the block count, a group start named after the scene, one colour entry
// per swatch, the group end. Big-endian throughout.

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u16 = (n: number) => [n >> 8, n & 255];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
// Code units, not characters: a character outside the basic plane is two.
const utf16 = (text: string) => Array.from({ length: text.length }, (_, i) => u16(text.charCodeAt(i))).flat();
const f32 = (n: number) => [...new Uint8Array(new Float32Array([n]).buffer)].reverse();

describe('an Adobe Swatch Exchange file', () => {
  it('writes two swatches in one group, byte for byte', () => {
    const name = 'SC 04 INT. KITCHEN';
    const entry = (hex: string, rgb: number[]) => {
      const label = [...u16(hex.length + 1), ...utf16(hex), ...u16(0)];
      return [...u16(1), ...u32(label.length + 4 + 12 + 2), ...label, ...ascii('RGB '), ...rgb.flatMap(f32), ...u16(2)];
    };
    const group = [...u16(name.length + 1), ...utf16(name), ...u16(0)];
    const expected = [
      ...ascii('ASEF'),
      ...u16(1),
      ...u16(0),
      ...u32(4),
      ...u16(0xc001),
      ...u32(group.length),
      ...group,
      ...entry('#DF5E27', [0xdf / 255, 0x5e / 255, 0x27 / 255]),
      ...entry('#000000', [0, 0, 0]),
      ...u16(0xc002),
      ...u32(0),
    ];
    expect([...aseBytes(name, ['#DF5E27', '#000000'])]).toEqual(expected);
  });

  it('has the lengths the format asks for: a colour entry is 36 bytes after its length, and the file is the sum', () => {
    const bytes = aseBytes('A', ['#FFFFFF']);
    const view = new DataView(bytes.buffer);
    // Header 12, group start 6 + (2 + 4), entry 6 + (2 + 16 + 4 + 12 + 2), group end 6.
    expect(bytes.length).toBe(12 + 12 + 6 + 36 + 6);
    expect(view.getUint32(8)).toBe(3);
    // The entry's length counts everything after the length field.
    expect(view.getUint16(24)).toBe(1);
    expect(view.getUint32(26)).toBe(2 + 16 + 4 + 12 + 2);
    expect(bytes.length - 30 - 6).toBe(view.getUint32(26));
    // Three floats of 1 for white, type 2 (normal).
    expect(view.getFloat32(30 + 18 + 4)).toBe(1);
    expect(view.getUint16(bytes.length - 6 - 2)).toBe(2);
  });

  it('writes a name outside ASCII in UTF-16BE and leaves out what is not a hex colour', () => {
    const bytes = aseBytes('Cocina á', ['not a colour', '#a35139']);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(8)).toBe(3);
    // "á" is one UTF-16 code unit: 0x00E1.
    expect(view.getUint16(20 + 2 * 7)).toBe(0xe1);
    // Lower-case hex is written as the palette keeps it, upper case.
    const text = new TextDecoder('utf-16be').decode(bytes.slice(bytes.length - 6 - 2 - 12 - 4 - 16, bytes.length - 6 - 2 - 12 - 4));
    expect(text).toBe('#A35139\0');
  });

  it('writes a character outside the basic plane as a surrogate pair, counted as two units', () => {
    const bytes = aseBytes('Escena \u{1F3AC}', []);
    const view = new DataView(bytes.buffer);
    // "Escena " is 7 units, the clapper board two, the null one.
    expect(view.getUint16(18)).toBe(10);
    expect(Array.from(bytes.slice(20 + 14, 20 + 18))).toEqual([0xd8, 0x3c, 0xdf, 0xac]);
  });

  it('cuts a very long name to 1,024 units with its null, never in the middle of a pair', () => {
    expect(new DataView(aseBytes('x'.repeat(5000), []).buffer).getUint16(18)).toBe(1024);
    // A pair that would straddle the cut is left out whole.
    const bytes = aseBytes('x'.repeat(1022) + '\u{1F3AC}', []);
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(18)).toBe(1023);
    expect(view.getUint16(20 + 1021 * 2)).toBe(0x78);
    expect(view.getUint16(20 + 1022 * 2)).toBe(0);
  });

  it('is a valid empty group with no swatches', () => {
    const bytes = aseBytes('Empty', []);
    expect(new DataView(bytes.buffer).getUint32(8)).toBe(2);
    expect(new DataView(bytes.buffer).getUint16(bytes.length - 6)).toBe(0xc002);
  });
});
