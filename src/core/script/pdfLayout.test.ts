import { describe, expect, it } from 'vitest';
import { parseScreenplayPdf, type PdfText } from './pdfLayout';

/** A line of Courier 12 at a row (12 points each, from the top of the text area) and an x, in points. */
const at = (page: number, row: number, x: number, text: string): PdfText => ({ page, x, y: 720 - row * 12, width: text.length * 7.2, text });

// A screenplay as a PDF lays it out: action at 1.5", dialogue at 2.5", parentheticals at 3.1", cues at 3.5", a
// transition far right, scene numbers in both margins and page numbers top right.
const SCRIPT: PdfText[] = [
  at(1, 20, 250, 'BEY COUNTY'),
  at(1, 23, 270, 'Written by'),
  at(1, 24, 266, 'Kevin Matos'),

  at(2, 0, 540, '2.'),
  at(2, 2, 72, '1'),
  at(2, 2, 108, 'INT. DINER - NIGHT'),
  at(2, 2, 540, '1'),
  at(2, 4, 108, 'Rain on the windows.'),
  at(2, 6, 252, 'MARY'),
  at(2, 7, 180, 'We’re closed.'),
  at(2, 9, 252, 'TOM (O.S.)'),
  at(2, 10, 223, '(quietly)'),
  at(2, 11, 180, 'Door was'),
  at(2, 11, 245, 'open.'),
  at(2, 13, 432, 'CUT TO:'),
  at(2, 15, 72, '2A'),
  at(2, 15, 108, 'EXT. ROOM 101 - DAY'),
  at(2, 15, 540, '2A'),
  at(2, 17, 108, 'BANG!'),
  at(2, 19, 252, 'MARY'),
  at(2, 20, 180, 'What was that?'),
  at(2, 21, 252, '(MORE)'),

  at(3, 0, 108, 'CONTINUED:'),
  at(3, 0, 540, '3.'),
  at(3, 2, 108, 'INT. ROOM 101 - CONTINUOUS'),
  at(3, 4, 252, "MARY (CONT'D)"),
  at(3, 5, 180, 'Still here?'),
];

describe('a screenplay PDF', () => {
  const script = parseScreenplayPdf(SCRIPT);

  it('finds scene headings by where they start, with the scene numbers printed in the margins', () => {
    expect(script.title).toBe('BEY COUNTY');
    expect(script.scenes.map((s) => [s.number, s.intExt, s.location, s.dayNight ?? s.otherTime])).toEqual([
      ['1', 'INT', 'DINER', 'NIGHT'],
      ['2A', 'EXT', 'ROOM 101', 'DAY'],
      [null, 'INT', 'ROOM 101', 'CONTINUOUS'],
    ]);
  });

  it('finds speakers by their cues, not capitals in action, transitions or (MORE)', () => {
    expect(script.scenes.map((s) => s.characters)).toEqual([['MARY', 'TOM'], ['MARY'], ['MARY']]);
  });

  it('measures a scene by the lines it fills on the page', () => {
    // Heading to transition: 12 printed lines with the blanks, about an eighth and a half.
    expect(script.scenes[0]?.eighths).toBe(2);
    expect(script.scenes.every((s) => s.eighths >= 1)).toBe(true);
  });

  it('reads a PDF with no text, such as a scan, as no scenes', () => {
    expect(parseScreenplayPdf([]).scenes).toEqual([]);
  });

  it('copes with a page whose margin isn’t the usual inch and a half', () => {
    const shifted = SCRIPT.filter((t) => t.page === 2).map((t) => ({ ...t, x: t.x - 36 }));
    expect(parseScreenplayPdf(shifted).scenes.map((s) => s.characters)).toEqual([['MARY', 'TOM'], ['MARY']]);
  });
});
