// The launch check's built-in PDF and picture (6.27l), written to src/app/launchCheck/builtIn.ts as base64, so the
// check reads a PDF and a picture of its own and never a person's file. Run it by hand after changing either, from the
// repo's root:
//
//   node scripts/launchCheckBuiltIn.ts
//
// The PDF: one page, one line of text in Helvetica (a standard font, nothing embedded), no object streams, fixed dates
// and producer. Its operators are written here rather than through pdf-lib's drawText, which names the page's font with
// a random suffix: so the same bytes come out every run. The picture: a 16 × 16 PNG of one saturated colour, made with
// Node's own zlib. A Vitest test (src/app/launchCheck/builtIn.test.ts) runs these functions again and checks the
// committed constants match.
// Plain TypeScript Node runs as is (type stripping, Node 22.18 and later): no enums.

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { beginText, endText, moveText, PDFDocument, PDFName, setFontAndSize, showText, StandardFonts } from 'pdf-lib';

/** The PDF's one line, which the check looks for in what the PDF worker reads back. */
export const LAUNCH_CHECK_LINE = 'INT. LAUNCH CHECK - DAY';

/** The picture's one colour: saturated, so the accent reader offers it. */
export const PICTURE_RGB: readonly [number, number, number] = [208, 32, 32];

const PICTURE_SIDE = 16;
/** Fixed, so the bytes never change with the day the script runs. */
const FIXED_DATE = new Date(Date.UTC(2026, 10, 20, 0, 0, 0));

/** The built-in PDF's bytes. */
export async function builtInPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer('Storiiboard launch check');
  doc.setCreator('Storiiboard launch check');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const page = doc.addPage([400, 100]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  page.pushOperators(
    beginText(),
    setFontAndSize('F1', 14),
    moveText(20, 45),
    showText(font.encodeText(LAUNCH_CHECK_LINE)),
    endText(),
  );
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

/** A PNG chunk: its length, type, data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typed.copy(out, 4);
  out.writeUInt32BE(crc32(typed), 8 + data.length);
  return out;
}

/** The built-in picture's bytes: a 16 × 16 RGB PNG of PICTURE_RGB. */
export function builtInPng(): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(PICTURE_SIDE, 0);
  header.writeUInt32BE(PICTURE_SIDE, 4);
  // 8 bits a channel, colour type 2 (RGB), deflate, no filter method beyond the standard, not interlaced.
  header.set([8, 2, 0, 0, 0], 8);
  // Each row: filter type 0, then its pixels.
  const row = [0, ...Array.from({ length: PICTURE_SIDE }, () => PICTURE_RGB).flat()];
  const raw = Buffer.from(Array.from({ length: PICTURE_SIDE }, () => row).flat());
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Bytes as base64, in lines of at most 100 characters, joined: so the written file keeps to its width. */
const base64Lines = (bytes: Uint8Array): string[] =>
  (Buffer.from(bytes).toString('base64').match(/.{1,100}/g) ?? []).map((line) => `  '${line}',`);

/** builtIn.ts as the script writes it. */
export async function builtInSource(): Promise<string> {
  return [
    '// Written by scripts/launchCheckBuiltIn.ts (node scripts/launchCheckBuiltIn.ts): never by hand. The launch',
    '// check’s own PDF and picture (6.27l), as base64; src/app/launchCheck/builtIn.test.ts checks they are what the',
    '// script makes.',
    '',
    `export const LAUNCH_CHECK_LINE = '${LAUNCH_CHECK_LINE}';`,
    '',
    'export const LAUNCH_CHECK_PDF = [',
    ...base64Lines(await builtInPdf()),
    "].join('');",
    '',
    'export const LAUNCH_CHECK_PNG = [',
    ...base64Lines(builtInPng()),
    "].join('');",
    '',
  ].join('\n');
}

const OUT = 'src/app/launchCheck/builtIn.ts';

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUT, await builtInSource());
  console.log(`Wrote ${OUT}.`);
}
