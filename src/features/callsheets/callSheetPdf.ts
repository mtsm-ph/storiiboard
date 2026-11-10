import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFString, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import tokens from '../../../design/tokens/tokens.json';
import { getLocale, list, t, tn } from '../../core/i18n';
import { dayDateFull, issueStamp, type CallSheet, type SheetContact, type SheetLocation, type SheetZone } from '../../core/model/callsheet';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { directionsLink } from '../../core/model/directions';
import { LOCATION_STATUS_LABEL } from '../../core/model/location';
import { PAPER_SIZES, type Paper } from '../../core/model/paper';
import { ROLE_LABELS } from '../../core/model/role';
import { dayDateLabel, isDayDate } from '../../core/model/shootDay';
import { pageLabel, sceneLabel } from '../../core/model/storyboard';
import type { SunBand, SunRange } from '../../core/model/sunTimes';
import { distanceText } from '../../core/net/hospitals';
import { momentIn, precipitationText, temperatureText, todayIn, windText, type DaySummary, type DayWeather, type WeatherUnits } from '../../core/net/weather';
import type { DirectionsApp } from '../../core/storage/settings';
import { INK, MUTED, printer, wrap, type PdfFonts } from '../export/pdfStoryboard';
import { headingOf } from '../storyboard/ScenesView';
import { MAP_HEIGHT, MAP_WIDTH, mapTilesFor, POINTS_PER_PIXEL, TILE_POINTS, type PdfMap } from './sheetMap';

// A day's call sheet as a PDF (4.6): Letter or A4, portrait, drawn with pdf-lib in the app's look on paper (ink on
// paper, 1.5 pt rules, mono labels, Inter Tight and JetBrains Mono from the bundled fonts). Pure: the sheet comes in
// as callSheet() worked it out, the forecasts as the tile holds them, the fonts as bytes; bytes go out. Nothing is
// fetched here. Everything is laid out as blocks measured before they are drawn, so a person's row, a scene's row and
// a location's block are never split by a page break.

/** The forecast the sheet holds for one location: whatever the tile shows, never fetched again for the PDF. */
export interface PdfForecast {
  day: DayWeather;
  /** ISO time the answer came from the network. */
  fetchedAt: string;
}

export interface CallSheetPdfInput {
  sheet: CallSheet;
  /** The title when the project has none of its own. */
  projectName: string;
  paper: Paper;
  /** The map app the directions link and the QR code open. */
  app: DirectionsApp;
  units: WeatherUnits;
  /** By location id; a location with no entry prints "Forecast not fetched". */
  forecasts: ReadonlyMap<string, PdfForecast>;
  fonts: PdfFonts;
  /** By location id: what each location's map image is drawn from (4.10). A location with no entry prints no map. */
  maps?: ReadonlyMap<string, PdfMap>;
  now?: Date;
  /** An issued sheet (4.7): its version and time are printed at the header's top right ("Revised" from version 2). */
  issue?: { version: number; issuedAt: Date };
}

export interface CallSheetPdf {
  bytes: Uint8Array;
  pages: number;
  /** The modules along one side of each QR code drawn (its version's size), in the order of the locations. */
  qr: number[];
  /** Whether some text had characters the fonts don't have, printed as ?. */
  replaced: boolean;
}

type Colour = ReturnType<typeof rgb>;
/** The hex token as a pdf-lib colour. */
const tokenColour = (hex: string): Colour => {
  const value = parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};
/** Burning Flame, golden hour's fixed token (design/tokens/tokens.json): the only fill on the sheet, with ink text. */
const HIGHLIGHT = tokenColour(tokens.color.highlight);

/** A tappable area over a link on the page (a URI annotation), for crew reading the sheet on a phone. */
function linkArea(page: PDFPage, href: string, x: number, y: number, width: number, height: number): void {
  const { context } = page.doc;
  const annotation = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(href) },
  });
  page.node.addAnnot(context.register(annotation));
}
/** The kit's 1.5px rules. */
const RULE = 1.5;
const MARGIN = 36;
/** The band under the content that the footer owns. */
const FOOTER = 30;
/** The QR code's side with its quiet zone: about 25 mm (71 pt). */
export const QR_SIZE = 25 * (72 / 25.4);
const QUIET_MODULES = 4;
/** Room kept free at the top right of the first page for the version and issue time (4.7). */
const RESERVED_WIDTH = 170;
/** What an issued sheet's stamp is given (4.7): the version and the issue time take up to three lines this wide. */
const STAMP_WIDTH = 250;

/** A QR code's modules, error correction M (4.6), or null for a link too long for any version. */
export function qrModules(link: string): boolean[][] | null {
  try {
    const code = qrcode(0, 'M');
    code.addData(link);
    code.make();
    const count = code.getModuleCount();
    return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, col) => code.isDark(row, col)));
  } catch {
    return null;
  }
}

interface Part {
  text: string;
  font: PDFFont;
  size: number;
  color?: Colour;
  /** Extra space after each letter: the kit's tracked labels. */
  track?: number;
  /** Where it starts across the block, when not straight after the one before. */
  x?: number;
  /** Drawn on Burning Flame, ink text (golden hour). */
  mark?: boolean;
  /** Makes the text a link. */
  href?: string;
}

const partWidth = (p: Part): number => p.font.widthOfTextAtSize(p.text, p.size) + (p.track ?? 0) * Array.from(p.text).length;

type Op = (page: PDFPage, left: number, top: number) => void;

/** A stretch of the sheet measured before it is drawn: lines going down, with a height. */
class Block {
  height = 0;
  readonly ops: Op[] = [];
  /** A label that goes at the left edge of the next line drawn, whose own parts then start where `x` says. */
  lead: Part | null = null;
  constructor(readonly width: number) {}

  /** One line of parts left to right (and `right` parts ending at `edge`); the line is `leading` tall. Returns its width. */
  line(parts: readonly Part[], leading: number, options: { x?: number; right?: readonly Part[]; edge?: number } = {}): number {
    const tallest = Math.max(0, this.lead?.size ?? 0, ...parts.map((p) => p.size), ...(options.right ?? []).map((p) => p.size));
    const baseline = this.height + leading - tallest * 0.25;
    let cursor = options.x ?? 0;
    const placed: { part: Part; at: number }[] = [];
    if (this.lead) {
      placed.push({ part: this.lead, at: 0 });
      this.lead = null;
    }
    for (const part of parts) {
      const at = part.x ?? cursor;
      placed.push({ part, at });
      cursor = at + partWidth(part);
    }
    const edge = options.edge ?? this.width;
    let rightCursor = edge - (options.right ?? []).reduce((n, p) => n + partWidth(p), 0);
    for (const part of options.right ?? []) {
      placed.push({ part, at: rightCursor });
      rightCursor += partWidth(part);
    }
    this.ops.push((page, left, top) => {
      for (const { part, at } of placed) {
        const width = partWidth(part);
        if (part.mark) {
          page.drawRectangle({ x: left + at - 3, y: top - baseline - 3, width: width + 6, height: part.size + 5, color: HIGHLIGHT });
        }
        if (part.track) page.pushOperators(setCharacterSpacing(part.track));
        page.drawText(part.text, { x: left + at, y: top - baseline, size: part.size, font: part.font, color: part.color ?? INK });
        if (part.track) page.pushOperators(setCharacterSpacing(0));
        if (part.href) linkArea(page, part.href, left + at, top - baseline - part.size * 0.25, width, part.size);
      }
    });
    this.height += leading;
    return cursor - (options.x ?? 0);
  }

  gap(height: number): void {
    this.height += height;
  }

  /** Something drawn by hand, `height` tall; the op is given the top of its area. */
  area(height: number, op: Op): void {
    const start = this.height;
    this.ops.push((page, left, top) => {
      op(page, left, top - start);
    });
    this.height += height;
  }

  /** A rule across the block's width, `at` down from its top. */
  rule(at: number): void {
    this.ops.push((page, left, top) => {
      page.drawLine({ start: { x: left, y: top - at }, end: { x: left + this.width, y: top - at }, thickness: RULE, color: INK });
    });
  }

  /** A 1.5 pt box around what lies between two heights of this block. */
  box(from: number, to: number): void {
    this.ops.push((page, left, top) => {
      page.drawRectangle({ x: left, y: top - to, width: this.width, height: to - from, borderColor: INK, borderWidth: RULE });
    });
  }

  /** Children side by side from here down, the block as tall as the tallest. */
  columns(children: readonly (readonly [Block, number])[]): void {
    const start = this.height;
    for (const [child, x] of children) {
      this.ops.push((page, left, top) => {
        for (const op of child.ops) op(page, left + x, top - start);
      });
    }
    this.height += Math.max(0, ...children.map(([child]) => child.height));
  }

  /** The QR code's modules as vector rectangles, runs along a row joined; the quiet zone is left empty. */
  qr(modules: boolean[][], href: string): void {
    const cell = QR_SIZE / (modules.length + 2 * QUIET_MODULES);
    const start = this.height;
    this.ops.push((page, left, top) => {
      linkArea(page, href, left, top - start - QR_SIZE, QR_SIZE, QR_SIZE);
      for (const [row, cells] of modules.entries()) {
        let col = 0;
        while (col < cells.length) {
          if (!cells[col]) {
            col += 1;
            continue;
          }
          const from = col;
          while (col < cells.length && cells[col]) col += 1;
          // A hair over the row below, so no viewer draws a seam between rows.
          page.drawRectangle({
            x: left + (QUIET_MODULES + from) * cell,
            y: top - start - (QUIET_MODULES + row + 1) * cell - 0.1,
            width: (col - from) * cell,
            height: cell + 0.1,
            color: INK,
          });
        }
      }
    });
    this.height += QR_SIZE;
  }

  draw(page: PDFPage, left: number, top: number): void {
    for (const op of this.ops) op(page, left, top);
  }
}

/** A section as it flows: its heading comes back, "(continued)", on a page it carries over to. */
interface Section {
  label: string;
  /** Column labels under the rule, as [text, right edge]. */
  columns?: readonly (readonly [string, number])[];
  started: boolean;
}

const dash = (time: string): string => (time === '' ? '—' : time);

export async function callSheetPdf(input: CallSheetPdfInput): Promise<CallSheetPdf> {
  const { sheet } = input;
  const now = input.now ?? new Date();
  const size = PAPER_SIZES[input.paper];
  const W = size.width - 2 * MARGIN;
  const title = sheet.title || input.projectName;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(t('callSheet.pdf.fileNameUndated', { title, number: sheet.day.number }));
  pdf.setCreator('Storiiboard');
  pdf.setProducer('Storiiboard');
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const f = {
    sans: await pdf.embedFont(input.fonts.sans, { subset: true }),
    semi: await pdf.embedFont(input.fonts.sansSemiBold, { subset: true }),
    bold: await pdf.embedFont(input.fonts.sansBold, { subset: true }),
    mono: await pdf.embedFont(input.fonts.mono, { subset: true }),
    monoBold: await pdf.embedFont(input.fonts.monoBold, { subset: true }),
  };
  const { printable, state } = printer();

  // The map pictures (4.10): one JPEG per location, composed from its tiles before this runs (composeMap.ts), so the file
  // holds one image per map and this stays pure.
  const mapImages = new Map<string, PDFImage>();
  for (const [id, map] of input.maps ?? []) {
    if (map.kind !== 'image') continue;
    try {
      mapImages.set(id, await pdf.embedJpg(map.jpeg));
    } catch {
      // Not a picture after all: the frame stays empty.
    }
  }

  // Parts, in the sheet's type: Inter Tight for words, JetBrains Mono for every time, number and code.
  const sans = (text: string, s = 10, color: Colour = INK): Part => ({ text: printable(f.sans, text), font: f.sans, size: s, color });
  const semi = (text: string, s = 10, color: Colour = INK): Part => ({ text: printable(f.semi, text), font: f.semi, size: s, color });
  const bold = (text: string, s = 10, color: Colour = INK): Part => ({ text: printable(f.bold, text), font: f.bold, size: s, color });
  const mono = (text: string, s = 9, color: Colour = INK): Part => ({ text: printable(f.mono, text), font: f.mono, size: s, color });
  const monoBold = (text: string, s = 9, color: Colour = INK): Part => ({ text: printable(f.monoBold, text), font: f.monoBold, size: s, color });
  /** The kit's label: uppercase mono, tracked 0.08em. */
  const label = (text: string, s = 8, color: Colour = MUTED): Part => ({ text: printable(f.mono, text.toLocaleUpperCase(getLocale())), font: f.mono, size: s, color, track: 0.08 * s });
  const gap = (n = 4): Part => ({ text: ' '.repeat(n), font: f.mono, size: 9 });

  /** A paragraph wrapped to `width`, one line per `leading`, at most `max` lines. */
  const para = (b: Block, text: string, make: (text: string) => Part, width: number, leading: number, x = 0, max = 40): void => {
    const probe = make('');
    for (const each of wrap(printable(probe.font, text), probe.font, probe.size, width, max)) b.line([make(each)], leading, { x });
  };
  /** A sentence with a time in it, the time in mono as everywhere else: `words` has a {time} in it. */
  const timed = (words: Parameters<typeof t>[0], time: string, s: number, color: Colour): Part[] => {
    const MARK = '\u0001';
    const [before = '', after = ''] = t(words, { time: MARK }).split(MARK);
    return [sans(before, s, color), mono(time, s, color), sans(after, s, color)].filter((p) => p.text !== '');
  };
  const zoneLine = ({ zone, source }: SheetZone): string => (source === 'computer' ? t('callSheet.timesInComputer') : t('callSheet.timesIn', { zone }));

  // What the footer credits: set as the blocks are built, read once the pages are known.
  const printed = { met: false, osm: false, mapCredits: new Set<string>() };
  const qrSides: number[] = [];

  // -- The blocks ------------------------------------------------------------------------------------------------------

  /** The first page's header: the title, what this is, the day, and the crew call large. */
  const firstHeader = (): Block => {
    const b = new Block(W);
    // The top right holds the version and the time it was issued (4.7), in the zone the sheet's times are in.
    const stamp = input.issue ? issueStamp(input.issue.version, input.issue.issuedAt, sheet.timesIn?.zone ?? null) : '';
    const room = stamp === '' ? RESERVED_WIDTH : STAMP_WIDTH;
    const titleLines = wrap(printable(f.bold, title), f.bold, 20, W - room, 2);
    const stampLines = stamp === '' ? [] : wrap(printable(f.monoBold, stamp), f.monoBold, 8, room - 12, 3);
    for (let i = 0; i < Math.max(titleLines.length, stampLines.length); i += 1) {
      const right = stampLines[i];
      b.line(titleLines[i] === undefined ? [] : [bold(titleLines[i] ?? '', 20)], 24, right === undefined ? {} : { right: [monoBold(right, 8)] });
    }
    b.gap(4);
    b.line([label(t('callSheet.pdf.header'), 10, INK)], 14);
    const dayText = t('callSheet.dayOf', { number: sheet.day.number, total: sheet.dayCount });
    const date = dayDateFull(sheet.day.fields.date) || t('callSheet.noDate');
    const dayPart = monoBold(dayText, 12);
    b.line([dayPart, gap(3), sans(date, 11)], 18);
    b.gap(6);
    const times = [
      [t('callSheet.crewCall'), sheet.day.fields.callTime, 30],
      [t('days.wrap'), sheet.day.fields.wrapTime, 16],
    ] as const;
    b.line([label(times[0][0], 8, MUTED), { ...label(times[1][0], 8, MUTED), x: 190 }], 12);
    b.line([monoBold(dash(times[0][1]), times[0][2]), { ...monoBold(dash(times[1][1]), times[1][2]), x: 190 }], 36);
    if (sheet.timesIn) b.line([sans(zoneLine(sheet.timesIn), 8, MUTED)], 12);
    b.gap(4);
    b.rule(b.height);
    b.gap(RULE + 6);
    return b;
  };

  /** Later pages: the title, "CALL SHEET" and the day, small. */
  const runningHeader = (): Block => {
    const b = new Block(W);
    const [shown = ''] = wrap(printable(f.bold, title), f.bold, 11, W - 260, 1);
    const right = [label(t('callSheet.pdf.header'), 8, INK), gap(2), monoBold(t('callSheet.dayOf', { number: sheet.day.number, total: sheet.dayCount }), 8)];
    b.line([bold(shown, 11)], 14, { right });
    b.gap(2);
    b.rule(b.height);
    b.gap(RULE + 6);
    return b;
  };

  const headingBlock = (section: Section, continued: boolean): Block => {
    const b = new Block(W);
    b.gap(10);
    b.line([label(section.label + (continued ? t('export.pdf.continued') : ''), 10, INK)], 14);
    b.rule(b.height);
    b.gap(RULE + 3);
    if (section.columns) {
      const parts = section.columns.map(([text, edge]) => {
        const part = label(text, 7.5);
        return { ...part, x: edge - partWidth(part) };
      });
      b.line(parts, 12);
    }
    return b;
  };

  const rangeText = (r: SunRange): string => {
    const mark = (next: boolean, prev: boolean) => (next ? ' +1' : prev ? ' −1' : '');
    return `${r.start}${mark(r.startNext, r.startPrev)}–${r.end}${mark(r.endNext, r.endPrev)}`;
  };

  const sunLines = (location: SheetLocation): Block => {
    const b = new Block(W);
    const { sun, zone } = location;
    // Nothing is guessed without a place, and nothing is printed until the zone and the date are known.
    if (!sun || !zone) return b;
    b.gap(5);
    b.line([label(t('callSheet.sun'))], 11);
    if (sun.state === 'normal') {
      const clockText = (time: string, next: boolean, prev: boolean) => `${time}${next ? ' +1' : prev ? ' −1' : ''}`;
      b.line(
        [
          label(t('callSheet.sunrise')),
          gap(1),
          mono(clockText(sun.sunrise, sun.sunriseNext, sun.sunrisePrev), 10),
          gap(6),
          label(t('callSheet.sunset')),
          gap(1),
          mono(clockText(sun.sunset, sun.sunsetNext, sun.sunsetPrev), 10),
        ],
        14,
      );
    } else {
      b.line([sans(sun.state === 'up' ? t('callSheet.sunUp') : t('callSheet.sunDown'), 10)], 14);
    }
    const band = (name: string, value: SunBand, golden: boolean) => {
      if (!value.allDay && !value.morning && !value.evening && !value.whole) return;
      const parts: Part[] = [golden ? { ...label(name, 8, INK), mark: true } : label(name, 8, INK)];
      const add = (words: string | null, text: string) => parts.push(gap(2), ...(words ? [sans(words, 9, MUTED), gap(1)] : []), mono(text, 9));
      if (value.allDay) add(null, t('callSheet.allDay'));
      if (value.whole) add(null, rangeText(value.whole));
      if (value.morning) add(t('callSheet.morning'), rangeText(value.morning));
      if (value.evening) add(t('callSheet.evening'), rangeText(value.evening));
      // Golden hour keeps its name in words as well as the colour, which a black-and-white copy loses.
      b.line(parts, 16, { x: golden ? 3 : 0 });
    };
    band(t('callSheet.goldenHour'), sun.golden, true);
    band(t('callSheet.blueHour'), sun.blue, false);
    b.line([sans(zoneLine(zone), 8, MUTED)], 11);
    return b;
  };

  const summaryLines = (b: Block, s: DaySummary): void => {
    const fact = (name: string, value: string): Part[] => [label(name), gap(1), mono(value, 9.5), gap(5)];
    const facts = [
      ...(s.high !== null ? fact(t('callSheet.weatherHigh'), temperatureText(s.high, input.units)) : []),
      ...(s.low !== null ? fact(t('callSheet.weatherLow'), temperatureText(s.low, input.units)) : []),
      ...(s.wind !== null ? fact(t('callSheet.weatherWind'), windText(s.wind, input.units)) : []),
      ...(s.precipitation !== null ? fact(t('callSheet.weatherRain'), precipitationText(s.precipitation, input.units)) : []),
    ];
    if (facts.length > 0) b.line(facts, 14);
    if (s.conditions !== null) b.line([label(t('callSheet.weatherAt', { time: s.at })), gap(1), sans(t(s.conditions), 10)], 14);
    // A day the forecast only partly covers says which part.
    if (s.from !== null) b.line(timed('callSheet.weatherFrom', s.from, 8.5, MUTED), 12);
    if (s.until !== null) b.line(timed('callSheet.weatherUntil', s.until, 8.5, MUTED), 12);
  };

  /** The forecast as the tile shows it: nothing for a day with no date, or one the forecast doesn't reach back to. */
  const weatherLines = (location: SheetLocation): Block => {
    const b = new Block(W);
    const { place, zone } = location;
    const date = sheet.day.fields.date;
    if (!place || !zone || !isDayDate(date)) return b;
    const held = input.forecasts.get(location.record.id);
    const day = held?.day;
    if (held && (!day || day.state === 'none')) return b;
    if (!held) {
      // A day gone by never asks, so there is nothing to say about a forecast that was never fetched.
      const today = todayIn(zone.zone, now);
      if (today !== null && date < today) return b;
    }
    b.gap(5);
    b.line([label(t('callSheet.weather'))], 11);
    if (!held || !day) {
      b.line([sans(t('callSheet.pdf.forecastNotFetched'), 10)], 14);
      return b;
    }
    if (day.state === 'summary') summaryLines(b, day);
    else if (day.state === 'beyond') b.line([sans(t('callSheet.weatherBeyond', { date: dayDateLabel(day.lastDate) }), 10)], 14);
    // The credit and when it was fetched, as the screen has them; MET's licence asks for the credit wherever it shows.
    printed.met = true;
    b.line(timed('callSheet.weatherFetched', momentIn(held.fetchedAt, zone.zone, now), 8.5, MUTED), 12);
    return b;
  };

  const safetyBox = (location: SheetLocation): Block => {
    const b = new Block(W);
    const { numbers, hospital } = location.safety;
    const [first, second] = numbers;
    b.gap(6);
    const start = b.height;
    const inset = 8;
    const inner = W - 2 * inset;
    b.gap(5);
    b.line([label(t('callSheet.safetyBox'))], 11, { x: inset });
    if (first === undefined) b.line([sans(t('emergency.checkLocally'), 10)], 14, { x: inset });
    else {
      b.line([label(t('emergency.label')), gap(2), monoBold(second === undefined ? first : t('emergency.two', { first, second }), 20)], 26, { x: inset });
    }
    if (hospital) {
      b.gap(3);
      b.line([label(t('callSheet.nearestHospital'))], 11, { x: inset });
      const distance = hospital.distanceKm === null ? null : mono(distanceText(hospital.distanceKm, input.units), 9.5);
      // The name wraps in the room the distance leaves, so the two never meet.
      const nameLines = wrap(printable(f.semi, hospital.name.trim()), f.semi, 10.5, inner - (distance ? partWidth(distance) + 12 : 0), 2);
      if (nameLines.length === 0 && distance) b.line([], 14, { x: inset, right: [distance], edge: W - inset });
      for (const [n, text] of nameLines.entries()) {
        b.line([semi(text, 10.5)], 14, { x: inset, ...(n === 0 && distance ? { right: [distance], edge: W - inset } : {}) });
      }
      if (hospital.address.trim() !== '') para(b, hospital.address, (s) => sans(s, 10), inner, 13, inset, 3);
      if (hospital.phone.trim() !== '') para(b, hospital.phone, (s) => mono(s, 9.5), inner, 13, inset, 2);
      // Truffle on a screen; ink on paper, with the ▲ as the mark.
      const sure = hospital.emergency;
      const noteX = inset + (sure ? 0 : 14);
      const note = wrap(printable(f.sans, sure ? t('hospital.emergencyRoom') : t('hospital.checkEmergencyRoom')), f.sans, 9.5, W - inset - noteX, 3);
      for (const [n, text] of note.entries()) {
        b.line(n === 0 && !sure ? [{ ...mono('▲', 9.5), x: inset }, { ...sans(text, 9.5), x: noteX }] : [{ ...sans(text, 9.5), x: noteX }], 13);
      }
      // The search is OpenStreetMap's (Nominatim).
      if (hospital.fromSearch) printed.osm = true;
    }
    b.gap(5);
    b.box(start, b.height);
    return b;
  };

  /**
   * The location's map (4.10): the tiles around its place at zoom 16 in a 60 x 40 mm frame (clipped to it), the pin in
   * vector on top, a 1.5 pt ink frame and the credit under it. Without tiles the frame is empty with one line, and in a
   * browser build it holds the grid the screen's map draws.
   */
  const mapBlock = (location: SheetLocation): Block | null => {
    const { place } = location;
    const map = input.maps?.get(location.record.id);
    if (!place || !map) return null;
    const b = new Block(W);
    b.gap(8);
    const image = mapImages.get(location.record.id);
    // A picture that would not embed is an empty frame like any other missing map.
    const words = map.kind === 'grid' ? t('map.browserOnly') : map.kind === 'none' ? map.why : image ? '' : t('callSheet.pdf.mapOffline');
    const lines = words === '' ? [] : wrap(printable(f.sans, words), f.sans, 7.5, MAP_WIDTH - 12, 3);
    b.area(MAP_HEIGHT, (page, left, top) => {
      const bottomEdge = top - MAP_HEIGHT;
      // The picture is the frame: cut to it already, so nothing can lie outside.
      if (image) page.drawImage(image, { x: left, y: bottomEdge, width: MAP_WIDTH, height: MAP_HEIGHT });
      else if (map.kind === 'grid') {
        // The grid the screen's map draws, clipped by hand to the frame's edges: whole squares only where they fit.
        for (const tile of mapTilesFor(place)) {
          const x0 = Math.max(left, left + tile.left * POINTS_PER_PIXEL);
          const x1 = Math.min(left + MAP_WIDTH, left + tile.left * POINTS_PER_PIXEL + TILE_POINTS);
          const y1 = Math.min(top, top - tile.top * POINTS_PER_PIXEL);
          const y0 = Math.max(bottomEdge, top - tile.top * POINTS_PER_PIXEL - TILE_POINTS);
          if (x1 > x0 && y1 > y0) page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, borderColor: MUTED, borderWidth: 0.5 });
        }
      }
      for (const [n, text] of lines.entries()) {
        const at = map.kind === 'grid' ? bottomEdge + 5 + (lines.length - 1 - n) * 9 : top - 14 - n * 10;
        page.drawText(text, { x: left + 6, y: at, size: 7.5, font: f.sans, color: MUTED });
      }
      // The pin at the place, which is the frame's centre: an ink ring with a paper dot, as the screen draws it.
      const centre = { x: left + MAP_WIDTH / 2, y: bottomEdge + MAP_HEIGHT / 2 };
      page.drawCircle({ ...centre, size: 5.5, color: rgb(1, 1, 1), borderColor: INK, borderWidth: RULE });
      page.drawCircle({ ...centre, size: 2, color: INK });
      page.drawRectangle({ x: left, y: bottomEdge, width: MAP_WIDTH, height: MAP_HEIGHT, borderColor: INK, borderWidth: RULE });
    });
    if (map.kind === 'grid' || (map.kind === 'image' && image)) {
      b.gap(2);
      // Wrapped to the frame's width, as many lines as it needs: a long credit of one's own is never cut.
      for (const each of wrap(printable(f.sans, map.credit), f.sans, 7, MAP_WIDTH, 40)) b.line([sans(each, 7, MUTED)], 9);
      printed.mapCredits.add(map.credit);
    }
    b.gap(2);
    return b;
  };

  /** A location as blocks that stay together when they fit a page, and split between them when they can't. */
  const locationBlocks = (location: SheetLocation): Block[] => {
    const { fields, place } = location;
    const b = new Block(W);
    b.gap(8);
    const name = fields.name || t('trash.unnamedLocation');
    const [shown = ''] = wrap(printable(f.bold, name), f.bold, 12, W - 110, 1);
    b.line([bold(shown, 12)], 17, { right: [label(LOCATION_STATUS_LABEL[fields.status])] });
    if (place) printed.osm = true;

    const link = directionsLink(input.app, fields, place);
    const modules = link ? qrModules(link) : null;
    const columnWidth = modules ? W - QR_SIZE - 14 : W;
    const left = new Block(columnWidth);
    if (fields.address.trim() === '') left.line([mono('▲ ', 9.5), sans(t('callSheet.noAddress'), 10)], 14);
    else para(left, fields.address, (s) => sans(s, 10.5), columnWidth, 14, 0, 3);
    const contactName = fields.contact_name.trim();
    const contactPhone = fields.contact_phone.trim();
    const rows = [
      t('callSheet.pdf.coordinates'),
      t('callSheet.pdf.directions'),
      t('callSheet.parking'),
      t('callSheet.power'),
      t('callSheet.contact'),
    ];
    const labelWidth = Math.max(...rows.map((r) => partWidth(label(r)))) + 8;
    const field = (name: string, lines: (b: Block, x: number, width: number) => void) => {
      // The label goes on the first line the field draws.
      left.lead = label(name);
      lines(left, labelWidth, columnWidth - labelWidth);
    };
    left.gap(3);
    if (place) {
      field(t('callSheet.pdf.coordinates'), (b, x) => b.line([mono(`${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}`, 9.5)], 14, { x }));
    }
    if (link) {
      field(t('callSheet.pdf.directions'), (b, x, width) => {
        // One line when it fits, so the link reads and copies whole; smaller before it wraps. Tappable on a phone.
        let linkSize = 8;
        while (linkSize > 6 && f.mono.widthOfTextAtSize(link, linkSize) > width) linkSize -= 0.5;
        para(b, link, (s) => ({ ...mono(s, linkSize), href: link }), width, 11, x, 4);
      });
    }
    if (fields.parking.trim() !== '') {
      field(t('callSheet.parking'), (b, x, width) => {
        para(b, fields.parking, (s) => sans(s, 10), width, 13, x, 4);
      });
    }
    if (fields.power.trim() !== '') {
      field(t('callSheet.power'), (b, x, width) => {
        para(b, fields.power, (s) => sans(s, 10), width, 13, x, 4);
      });
    }
    if (contactName !== '' || contactPhone !== '') {
      field(t('callSheet.contact'), (b, x, width) => {
        if (contactName !== '') para(b, contactName, (s) => sans(s, 10), width, 13, x, 2);
        if (contactPhone !== '') b.line([mono(contactPhone, 9.5)], 13, { x });
      });
    }
    const side = new Block(QR_SIZE);
    if (modules && link) {
      side.qr(modules, link);
      qrSides.push(modules.length);
      para(side, t('callSheet.pdf.scan'), (s) => ({ ...label(s, 6.5), href: link }), QR_SIZE, 8, 0, 2);
    }
    b.columns(modules ? [[left, 0], [side, W - QR_SIZE]] : [[left, 0]]);
    const end = safetyBox(location);
    end.gap(8);
    end.rule(end.height - 0.75);
    return [b, mapBlock(location), sunLines(location), weatherLines(location), end].filter((block): block is Block => block !== null).filter((block) => block.height > 0);
  };

  // -- The flow --------------------------------------------------------------------------------------------------------

  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;
  let pageStart = 0;
  const bottom = MARGIN + FOOTER;
  const newPage = (): void => {
    page = pdf.addPage([size.width, size.height]);
    const first = pages.length === 0;
    pages.push(page);
    y = size.height - MARGIN;
    const header = first ? firstHeader() : runningHeader();
    header.draw(page, MARGIN, y);
    y -= header.height;
    pageStart = y;
  };
  newPage();
  /** What a page after the first holds under its header. */
  const capacity = size.height - MARGIN - runningHeader().height - bottom;
  const emit = (block: Block | null): void => {
    if (!block) return;
    block.draw(page, MARGIN, y);
    y -= block.height;
  };

  /** What goes at the top of a page a group carries over to: `onMove` also when the whole group moves, as a department's rows do. */
  interface Carry {
    block: () => Block;
    onMove: boolean;
  }

  /**
   * Puts blocks on a page together. One that doesn't fit here but would on a fresh page moves to it, a section's
   * heading with it (again, "(continued)", on a page the section carries over to). Blocks that fit no page are split
   * between blocks, each new page starting with the group's `carry` line. A single block taller than a page would still
   * be drawn whole and run past the footer: none the sheet builds comes near (the tallest, a location's top, is about
   * 271 pt of a later page's 637), so a block added later must split itself before it gets that tall.
   */
  const place = (blocks: readonly Block[], section?: Section, carry?: Carry): void => {
    const first = section !== undefined && !section.started;
    const headFor = (continued: boolean): Block | null => (section ? headingBlock(section, continued) : null);
    const total = blocks.reduce((n, b) => n + b.height, 0);
    if (section) section.started = true;
    const movable = y < pageStart || pages.length === 1;
    if (y - total - (first ? (headFor(false)?.height ?? 0) : 0) >= bottom) {
      if (first) emit(headFor(false));
      for (const block of blocks) emit(block);
      return;
    }
    const carried = carry?.onMove ? carry.block() : null;
    if (movable && total + (headFor(!first)?.height ?? 0) + (carried?.height ?? 0) <= capacity) {
      newPage();
      emit(headFor(!first));
      emit(carried);
      for (const block of blocks) emit(block);
      return;
    }
    // Too tall for any page: between blocks, so no line is cut.
    for (const [i, block] of blocks.entries()) {
      const head = i === 0 && first ? headFor(false) : null;
      if (y - (head?.height ?? 0) - block.height < bottom && (y < pageStart || pages.length === 1)) {
        newPage();
        emit(headFor(!(i === 0 && first)));
        if (i > 0 && carry) emit(carry.block());
      } else emit(head);
      emit(block);
    }
  };

  // Locations
  if (sheet.locations.length > 0) {
    const section: Section = { label: t('callSheet.section.locations'), started: false };
    for (const location of sheet.locations) {
      const carry = (): Block => {
        const b = new Block(W);
        const [shown = ''] = wrap(printable(f.bold, location.fields.name || t('trash.unnamedLocation')), f.bold, 12, W - 140, 1);
        b.gap(8);
        b.line([bold(shown, 12), sans(t('export.pdf.continued'), 10, MUTED)], 17);
        return b;
      };
      place(locationBlocks(location), section, { block: carry, onMove: false });
    }
  }

  // Scenes
  if (sheet.nothingLeft) {
    const b = new Block(W);
    b.gap(6);
    b.line([sans(t('callSheet.nothingLeft'), 10, MUTED)], 14);
    place([b], { label: t('callSheet.section.scenes'), started: false });
  } else if (sheet.scenes.length > 0) {
    const section: Section = { label: t('callSheet.section.scenes'), started: false };
    const indent = 56;
    const actorX = indent + 150;
    for (const { fields, location, frames, characters } of sheet.scenes) {
      const top = new Block(W);
      top.gap(5);
      const number = monoBold(sceneLabel(fields.number), 10);
      const lines = wrap(printable(f.semi, headingOf(fields)), f.semi, 10.5, W - indent - 70, 2);
      top.line([number, { ...semi(lines[0] ?? '', 10.5), x: indent }], 15, { right: [mono(pageLabel(fields.pageEighths), 9)] });
      for (const more of lines.slice(1)) top.line([semi(more, 10.5)], 14, { x: indent });
      // The places the scene is shot at (several, joined) wrap in the room the frame count leaves.
      const count = mono(tn('count.frames', frames), 9, MUTED);
      const where = location === null ? [] : wrap(printable(f.sans, t('callSheet.atLocation', { location })), f.sans, 9, W - indent - partWidth(count) - 12, 3);
      if (where.length === 0) top.line([count], 13, { x: indent });
      for (const [n, text] of where.entries()) top.line([sans(text, 9, MUTED)], 13, { x: indent, ...(n === 0 ? { right: [count] } : {}) });
      const blocks = [top];
      for (const character of characters) {
        // A character and the actor each wrap in their own column.
        const nameLines = wrap(printable(f.semi, character.name), f.semi, 9.5, 150 - 10, 2);
        const actorText = character.cast ? character.cast.fields.name || t('people.unnamed') : t('callSheet.notCast');
        const actorLines = wrap(printable(f.sans, actorText), f.sans, 9.5, W - actorX, 2);
        const row = new Block(W);
        for (let n = 0; n < Math.max(nameLines.length, actorLines.length); n += 1) {
          const name = nameLines[n];
          const actor = actorLines[n];
          row.line(
            [...(name === undefined ? [] : [semi(name, 9.5)]), ...(actor === undefined ? [] : [{ ...sans(actor, 9.5, character.cast ? INK : MUTED), x: actorX }])],
            13,
            { x: indent },
          );
        }
        if (character.cast && !character.onDay) row.line([{ ...sans(t('callSheet.notOnDay'), 8.5, MUTED), x: actorX }], 12, { x: indent });
        blocks.push(row);
      }
      const last = blocks.at(-1) ?? top;
      last.gap(5);
      last.rule(last.height - 0.75);
      const carry = (): Block => {
        const b = new Block(W);
        b.gap(5);
        b.line([number, { ...sans(t('export.pdf.continued'), 10, MUTED), x: indent }], 15);
        return b;
      };
      place(blocks, section, { block: carry, onMove: false });
    }
  }

  const contactParts = (contact: SheetContact | null): string =>
    contact ? [contact.phone, contact.email].filter((part) => part.trim() !== '').join(' · ') : '';

  // Cast: name, characters and contact on the left; call, HMU ready and on set in columns.
  if (sheet.cast.length > 0) {
    const columns = [W - 132, W - 66, W] as const;
    const section: Section = {
      label: t('callSheet.section.cast'),
      columns: [
        [t('callSheet.call'), columns[0]],
        [t('callSheet.hmuReady'), columns[1]],
        [t('callSheet.onSet'), columns[2]],
      ],
      started: false,
    };
    for (const { person, characters, times, contact } of sheet.cast) {
      const b = new Block(W);
      b.gap(4);
      const time = (value: string, edge: number): Part => {
        const part = monoBold(dash(value), 10);
        return { ...part, x: edge - partWidth(part) };
      };
      const [shownName = ''] = wrap(printable(f.semi, person.fields.name || t('people.unnamed')), f.semi, 10.5, W - 215, 1);
      b.line([semi(shownName, 10.5), time(times.call, columns[0]), time(times.hmuReady, columns[1]), time(times.onSet, columns[2])], 15);
      if (characters.length > 0) para(b, t('callSheet.plays', { characters: list(characters) }), (s) => sans(s, 9, MUTED), W - 150, 12, 0, 3);
      const contactText = contactParts(contact);
      if (contactText !== '') para(b, contactText, (s) => mono(s, 8.5, MUTED), W - 150, 11, 0, 2);
      b.gap(4);
      b.rule(b.height - 0.75);
      place([b], section);
    }
  }

  // Crew by department, in the call sheet's order: the department and its call, then each person.
  if (sheet.crew.length > 0) {
    const section: Section = { label: t('callSheet.section.crew'), started: false };
    // A person's name and title each wrap in their own half of the room the call leaves.
    const room = W - 70;
    const nameWidth = room * 0.5;
    const titleX = nameWidth + 8;
    for (const group of sheet.crew) {
      const departmentLine = (continued: boolean): Block => {
        const head = new Block(W);
        head.gap(6);
        const name = (group.department ? DEPARTMENT_LABELS[group.department] : t('callSheet.noDepartment')) + (continued ? t('export.pdf.continued') : '');
        const callPart = group.call !== null ? [label(t('callSheet.call')), gap(1), monoBold(dash(group.call), 10)] : [];
        head.line([bold(name.toLocaleUpperCase(getLocale()), 10.5)], 15, { right: callPart });
        return head;
      };
      const rows = group.people.map(({ fields, call, contact }) => {
        const b = new Block(W);
        b.gap(2);
        const what = fields.title.trim() || (fields.role ? ROLE_LABELS[fields.role] : '');
        const nameLines = wrap(printable(f.semi, fields.name || t('people.unnamed')), f.semi, 10, nameWidth, 2);
        const whatLines = wrap(printable(f.sans, what), f.sans, 9.5, room - titleX, 2);
        for (let n = 0; n < Math.max(nameLines.length, whatLines.length); n += 1) {
          const name = nameLines[n];
          const title = whatLines[n];
          b.line(
            [...(name === undefined ? [] : [semi(name, 10)]), ...(title === undefined ? [] : [{ ...sans(title, 9.5, MUTED), x: titleX }])],
            14,
            n === 0 ? { right: [monoBold(dash(call), 10)] } : {},
          );
        }
        const contactText = contactParts(contact);
        if (contactText !== '') para(b, contactText, (s) => mono(s, 8.5, MUTED), W - 80, 11, 0, 2);
        b.gap(2);
        return b;
      });
      const last = rows.at(-1);
      if (last) {
        last.rule(last.height);
        last.gap(RULE);
      }
      // The department's name never stands alone at the foot of a page: it goes with its first person.
      const [firstRow, ...rest] = rows;
      place(firstRow ? [departmentLine(false), firstRow] : [departmentLine(false)], section);
      // A department that carries over to a page says so.
      for (const row of rest) place([row], section, { block: () => departmentLine(true), onMove: true });
    }
  }

  // Notes: the sheet's general notes, then the safety notes. A long note flows, ten lines at a time.
  const notes = [
    [t('callSheet.general'), sheet.notes.general],
    [t('callSheet.safety'), sheet.notes.safety],
  ] as const;
  if (notes.some(([, text]) => text.trim() !== '')) {
    const section: Section = { label: t('callSheet.section.notes'), started: false };
    for (const [name, text] of notes) {
      if (text.trim() === '') continue;
      const lines = text.split(/\r?\n/).flatMap((paragraph) => (paragraph.trim() === '' ? [''] : wrap(printable(f.sans, paragraph), f.sans, 10, W, 200)));
      for (let from = 0; from < lines.length; from += 10) {
        const b = new Block(W);
        if (from === 0) {
          b.gap(6);
          b.line([label(name)], 12);
        }
        for (const each of lines.slice(from, from + 10)) b.line(each === '' ? [] : [sans(each, 10)], 13);
        place([b], section);
      }
    }
  }

  // -- Footers, once the number of pages is known -----------------------------------------------------------------------
  // The footer's credits take the lines they need. Past 2 lines they would run into the bottom margin, where some
  // printers can't print, so the provider's own credit then stays under its map only, in full.
  const footerCredits = (withOwn: boolean): string[] => [
    ...(printed.met ? [t('callSheet.weatherCredit')] : []),
    ...(printed.osm ? [t('callSheet.osmCredit')] : []),
    ...(withOwn ? [...printed.mapCredits].filter((credit) => credit !== t('callSheet.osmCredit')) : []),
    t('callSheet.pdf.madeWith'),
  ];
  const footerLines = (credits: string[]): string[] => wrap(printable(f.mono, credits.join(' · ')), f.mono, 7, W - 100, 40);
  let credits = footerLines(footerCredits(true));
  if (credits.length > 2) credits = footerLines(footerCredits(false));
  for (const [index, each] of pages.entries()) {
    const foot = new Block(W);
    foot.rule(0);
    foot.gap(RULE + 1);
    const total = t('callSheet.pdf.page', { page: index + 1, pages: pages.length });
    for (const [n, text] of credits.entries()) {
      foot.line([mono(text, 7, MUTED)], 9, n === 0 ? { right: [mono(total, 8, MUTED)] } : {});
    }
    foot.draw(each, MARGIN, MARGIN + FOOTER - 8);
  }

  return { bytes: await pdf.save(), pages: pages.length, qr: qrSides, replaced: state.replaced };
}
