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

  it('leaves out revision marks, (MORE) and CONTINUED, and reads past a page that’s all dialogue', () => {
    const revised: PdfText[] = [
      at(1, 2, 108, 'INT. DINER - CONTINUOUS'),
      at(1, 2, 560, '*'),
      at(1, 4, 108, 'Rain.'),
      at(1, 6, 252, 'MARY'),
      at(1, 6, 560, '*'),
      at(1, 7, 180, 'Again.'),
      at(1, 9, 252, '(MORE)'),
      at(1, 10, 108, 'CONTINUED:'),
      // A page of dialogue alone: few of its lines start at the action margin.
      ...Array.from({ length: 6 }, (_, i) => [at(2, i * 3, 252, i % 2 ? 'TOM' : 'JOE'), at(2, i * 3 + 1, 180, 'Words.')]).flat(),
      at(2, 20, 108, 'EXT. ROAD - DAY'),
      at(2, 20, 540, '8'),
    ];
    const script = parseScreenplayPdf(revised);
    expect(script.scenes.map((s) => [s.number, s.location, s.otherTime ?? s.dayNight, s.characters])).toEqual([
      [null, 'DINER', 'CONTINUOUS', ['MARY', 'JOE', 'TOM']],
      ['8', 'ROAD', 'DAY', []],
    ]);
  });

  it('takes any short number in the margins as the scene number, combined scenes and letters first included', () => {
    for (const number of ['12-14', '7a', 'A7']) {
      const scene = parseScreenplayPdf([at(1, 2, 72, number), at(1, 2, 108, 'INT. BARN - DAWN'), at(1, 4, 108, 'Hay.')]).scenes;
      expect(scene.map((s) => [s.number, s.location])).toEqual([[number, 'BARN']]);
    }
  });

  it('reads both speakers of dual dialogue, side by side', () => {
    const dual: PdfText[] = [
      at(1, 2, 108, 'INT. DINER - NIGHT'),
      at(1, 4, 108, 'They talk over each other.'),
      at(1, 6, 216, 'MARY'),
      at(1, 6, 432, 'TOM'),
      at(1, 7, 144, 'Closed.'),
      at(1, 7, 360, 'Open.'),
    ];
    expect(parseScreenplayPdf(dual).scenes[0]?.characters).toEqual(['MARY', 'TOM']);
  });

  it('has no title when the script starts on page one, and keeps a baseline whole through rounding noise', () => {
    const noTitle = parseScreenplayPdf([at(1, 0, 108, 'FADE IN:'), at(1, 2, 108, 'INT. A - DAY'), at(1, 4, 108, 'Light.')]);
    expect(noTitle.title).toBeNull();
    const noisy = parseScreenplayPdf([
      { page: 1, x: 72, y: 697.0000001, width: 7.2, text: '9' },
      { page: 1, x: 108, y: 696.9999999, width: 100, text: 'INT. A - DAY' },
    ]);
    expect(noisy.scenes[0]?.number).toBe('9');
  });

  it('copes with a page whose margin isn’t the usual inch and a half', () => {
    const shifted = SCRIPT.filter((t) => t.page === 2).map((t) => ({ ...t, x: t.x - 36 }));
    expect(parseScreenplayPdf(shifted).scenes.map((s) => s.characters)).toEqual([['MARY', 'TOM'], ['MARY']]);
  });
});
