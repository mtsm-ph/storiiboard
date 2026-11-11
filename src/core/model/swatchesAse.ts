import { normalHex } from './palette';

// Adobe Swatch Exchange (.ase), written by our own code (5.6b, decision 9): a small binary format, so no dependency. All numbers
// are big-endian.
//
//   "ASEF"  u16 version major (1)  u16 version minor (0)  u32 block count
//   then each block: u16 type, u32 length of what follows the length, and that many bytes
//     0xC001 group start: u16 name length (UTF-16 code units, including the terminating null), the name in UTF-16BE, null
//     0x0001 colour entry: u16 name length, the name (UTF-16BE, null), "RGB " (four ASCII bytes), three f32 values 0 to 1
//                          (red, green, blue), u16 colour type (0 global, 1 spot, 2 normal)
//     0xC002 group end: length 0
//
// One group holds the swatches, named after the scene's heading or the company; each colour is named by its hex.

const BLOCK_GROUP_START = 0xc001;
const BLOCK_GROUP_END = 0xc002;
const BLOCK_COLOUR = 0x0001;
const COLOUR_NORMAL = 2;

/** A name's longest, with its null: readers stop at about this many UTF-16 code units. */
const MAX_NAME_UNITS = 1024;

/** A name as UTF-16BE with its terminating null, behind its length in code units (the null counted). */
function nameBytes(full: string): Uint8Array {
  // Cut by code units, never between the two halves of a character outside the basic plane.
  let name = full.slice(0, MAX_NAME_UNITS - 1);
  const last = name.charCodeAt(name.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) name = name.slice(0, -1);
  const units = name.length + 1;
  const out = new Uint8Array(2 + units * 2);
  const view = new DataView(out.buffer);
  view.setUint16(0, units);
  for (let i = 0; i < name.length; i += 1) view.setUint16(2 + i * 2, name.charCodeAt(i));
  return out;
}

/** The `.ase` file for these colours in one group; a value that isn't a six-digit hex colour is left out. */
export function aseBytes(groupName: string, hexes: readonly string[]): Uint8Array {
  const colours = hexes.flatMap((hex) => {
    const normal = normalHex(hex);
    return normal ? [normal] : [];
  });
  const group = nameBytes(groupName);
  const entries = colours.map((hex) => ({ name: nameBytes(hex), hex }));
  const size = 12 + (6 + group.length) + entries.reduce((n, e) => n + 6 + e.name.length + 4 + 12 + 2, 0) + 6;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (value: number) => {
    view.setUint16(at, value);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value);
    at += 4;
  };
  const bytes = (data: Uint8Array) => {
    out.set(data, at);
    at += data.length;
  };
  bytes(Uint8Array.from('ASEF', (c) => c.charCodeAt(0)));
  u16(1);
  u16(0);
  u32(entries.length + 2);
  u16(BLOCK_GROUP_START);
  u32(group.length);
  bytes(group);
  for (const { name, hex } of entries) {
    u16(BLOCK_COLOUR);
    u32(name.length + 4 + 12 + 2);
    bytes(name);
    bytes(Uint8Array.from('RGB ', (c) => c.charCodeAt(0)));
    for (const i of [1, 3, 5]) {
      view.setFloat32(at, parseInt(hex.slice(i, i + 2), 16) / 255);
      at += 4;
    }
    u16(COLOUR_NORMAL);
  }
  u16(BLOCK_GROUP_END);
  u32(0);
  return out;
}
