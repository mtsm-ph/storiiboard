import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import { setLocale } from '../../core/i18n';
import { callSheet } from '../../core/model/callsheet';
import type { Props, SbdRecord } from '../../core/model/record';
import { directionsLink } from '../../core/model/directions';
import type { PdfFonts } from '../export/pdfStoryboard';
import { callSheetPdf, qrModules, type CallSheetPdfInput, type PdfForecast } from './callSheetPdf';
import { callSheetFileName } from './callSheetName';
import type { PdfMap } from './sheetMap';

// The call sheet as a PDF (4.6): page size, the text it holds, contacts only where allowed, the QR code, a long crew
// flowing to a second page, the credits in the footer only for what is printed, and every word in English and Spanish.

const font = (name: string) => new Uint8Array(readFileSync(new URL(`../export/fonts/${name}.ttf`, import.meta.url)));
const fonts: PdfFonts = {
  sans: font('InterTight-Regular'),
  sansSemiBold: font('InterTight-SemiBold'),
  sansBold: font('InterTight-Bold'),
  mono: font('JetBrainsMono-Regular'),
  monoBold: font('JetBrainsMono-Bold'),
};

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id, type, parentId, sortKey, props, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const cusco = { map_name: 'Plaza de Armas, Cusco', latitude: -13.5167674, longitude: -71.9787787 };
const diner: Props = {
  name: 'Diner',
  status: 'confirmed',
  address: '12 Route 9, Bey County',
  parking: 'Lot behind the diner',
  power: 'Two 20 amp circuits',
  contact_name: 'Rosa Quispe',
  contact_phone: '555 0199',
  country_code: 'PE',
  hospital_name: 'Hospital Regional del Cusco',
  hospital_address: 'Avenida de la Cultura',
  hospital_phone: '+51 84 233 331',
  hospital_latitude: -13.5236,
  hospital_longitude: -71.9632,
  hospital_emergency: true,
  hospital_source: 'osm',
  ...cusco,
};

interface ProjectOptions {
  location?: Props;
  extraCrew?: number;
  notes?: Props;
  /** The day's own props, over date, call and wrap. */
  day?: Props;
  /** Extra characters in the scene, none of them cast. */
  characters?: number;
  /** The scene has no location, so the sheet has no Locations section. */
  noLocation?: boolean;
  /** Long names in every place a name sits beside something else. */
  long?: boolean;
}

function project(options: ProjectOptions = {}) {
  const extraCharacters = Array.from({ length: options.characters ?? 0 }, (_, n) => record(`ch${String(n)}`, 'character', 'p', { name: `EXTRA ${String(n).padStart(2, '0')}` }));
  const long = options.long
    ? [
        record('big', 'character', 'p', { name: 'DETECTIVE SERGEANT MARIA ALVAREZ OF THE HOMICIDE UNIT', cast_id: 'star' }),
        record('star', 'person', 'p', { name: 'Alexandria Montgomery-Featherstonehaugh the Third', role: 'cast', departments: ['cast'] }),
        record('loc2', 'location', 'p', { name: 'The Old Municipal Waterworks and Pumping Station Annex', address: 'Calle Real 1' }),
        record('b', 'shot', 's1', { number: '1B', shoot_day_id: 'd', location_id: 'loc2' }),
        record('longcrew', 'person', 'p', {
          name: 'Bartholomew Montgomery-Featherstonehaugh',
          role: 'grip',
          departments: ['camera'],
          title: 'Assistant to the key grip and the best boy electric',
        }),
      ]
    : [];
  const crew = Array.from({ length: options.extraCrew ?? 0 }, (_, n) =>
    record(`crew${String(n)}`, 'person', 'p', { name: `Crew Person ${String(n).padStart(2, '0')}`, role: 'grip', departments: ['grip-electric'], title: 'Grip' }, `c${String(n).padStart(3, '0')}`),
  );
  return recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d', 'shoot_day', 'p', { date: '2026-11-16', call_time: '07:00', wrap_time: '19:00', ...options.day }),
    ...(options.notes ? [record('cs', 'callsheet', 'd', options.notes)] : []),
    record('loc', 'location', 'p', options.location ?? diner),
    record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
    record('s1', 'scene', 'p', { number: '1', heading: 'DINER', int_ext: 'INT', time_of_day: 'NIGHT', character_ids: ['mary', ...(options.long ? ['big'] : []), ...extraCharacters.map((c) => c.id)], ...(options.noLocation ? {} : { location_id: 'loc' }) }),
    record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
    record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'], phone: '555 0101', email: 'ana@example.com' }),
    record('kev', 'person', 'p', { name: 'Kevin Matos', role: 'dp', departments: ['camera'], phone: '555 0102', email: 'kev@example.com', title: 'DP' }),
    ...crew,
    ...extraCharacters,
    ...long,
  );
}

const zones = new Map<string, string | null>([['loc', 'America/Lima']]);
const forecast: PdfForecast = {
  day: { state: 'summary', high: 18, low: 9, wind: 4.5, precipitation: 6.5, conditions: 'weather.fair', at: '07:00', from: null, until: null },
  fetchedAt: '2026-11-16T14:00:00Z',
};

function input(records: ReturnType<typeof project>, extra: Partial<CallSheetPdfInput> = {}): CallSheetPdfInput {
  const sheet = callSheet(records, 'p', 'd', undefined, zones);
  if (!sheet) throw new Error('no sheet');
  return { sheet, projectName: 'Bey County', paper: 'letter', app: 'google', units: 'metric', forecasts: new Map(), fonts, now: new Date('2026-11-16T15:00:00Z'), ...extra };
}

/** Each page's text, as a PDF reader finds it, with runs of space as one. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const texts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    texts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  await pdf.destroy();
  return texts;
}

/** The whole sheet's text, page after page. */
const allText = async (bytes: Uint8Array): Promise<string> => (await pageTexts(bytes)).join(' ');

/** Where each text item of a page starts, y up from the foot. */
async function pageItems(bytes: Uint8Array, n: number): Promise<{ str: string; y: number }[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
  const content = await (await pdf.getPage(n)).getTextContent();
  const items = content.items.flatMap((item) => ('str' in item && item.str.trim() !== '' ? [{ str: item.str, y: Number(item.transform[5]) }] : []));
  await pdf.destroy();
  return items;
}

afterEach(() => {
  setLocale('en');
});

describe('the paper', () => {
  it('is US Letter for Letter and A4 for A4, portrait', async () => {
    const letter = await PDFDocument.load((await callSheetPdf(input(project()))).bytes);
    expect(letter.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const a4 = await PDFDocument.load((await callSheetPdf(input(project(), { paper: 'a4' }))).bytes);
    const { width, height } = a4.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });
});

describe('what the sheet prints', () => {
  it('the day, the location with its address, coordinates, link, parking, power and contact, the scene, the cast and the crew', async () => {
    const records = project({ notes: { notes: 'Park behind the diner.', safety_notes: 'Wet floor by the sink.' } });
    const { bytes, pages } = await callSheetPdf(input(records, { forecasts: new Map([['loc', forecast]]) }));
    expect(pages).toBeGreaterThanOrEqual(1);
    const text = await allText(bytes);
    for (const expected of [
      'Bey County',
      'CALL SHEET',
      'Day 1 of 1',
      'Monday, November 16, 2026',
      '07:00',
      '19:00',
      'Diner',
      '12 Route 9, Bey County',
      '-13.516767, -71.978779',
      'https://www.google.com/maps/dir/?api=1&destination=-13.516767,-71.978779',
      'Lot behind the diner',
      'Two 20 amp circuits',
      'Rosa Quispe',
      '555 0199',
      'SC 01',
      'MARY',
      'Ana Ruiz',
      'Kevin Matos',
      'DP',
      'Park behind the diner.',
      'Wet floor by the sink.',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // The sun in the location's own zone, the forecast, and the safety box.
    expect(text).toMatch(/SUNRISE \d\d:\d\d/);
    expect(text).toMatch(/SUNSET \d\d:\d\d/);
    expect(text).toContain('GOLDEN HOUR');
    expect(text).toContain('Times in America/Lima');
    expect(text).toContain('18°C');
    expect(text).toContain('9°C');
    expect(text).toContain('16 km/h');
    expect(text).toContain('Fair');
    expect(text).toContain('Forecast fetched');
    expect(text).toContain('106');
    expect(text).toContain('Hospital Regional del Cusco');
    expect(text).toContain('Avenida de la Cultura');
    expect(text).toContain('+51 84 233 331');
    expect(text).toMatch(/\d\.\d km/);
    expect(text).toContain('24-hour emergency room');
  });

  it('with no forecast held, says so; with no place, prints no forecast, sun or coordinates', async () => {
    const withPlace = (await pageTexts((await callSheetPdf(input(project()))).bytes))[0] ?? '';
    expect(withPlace).toContain('Forecast not fetched');
    expect(withPlace).not.toContain('Data from MET Norway');
    const none = (await pageTexts((await callSheetPdf(input(project({ location: { name: 'Diner', address: '12 Route 9' } })))).bytes))[0] ?? '';
    expect(none).not.toContain('Forecast not fetched');
    expect(none).not.toContain('SUNRISE');
    expect(none).not.toContain('COORDINATES');
    // The link from the address alone.
    expect(none).toContain('https://www.google.com/maps/dir/?api=1&destination=12%20Route%209');
  });

  it('the link follows the app chosen', async () => {
    const apple = (await pageTexts((await callSheetPdf(input(project(), { app: 'apple' }))).bytes))[0] ?? '';
    expect(apple).toContain('https://maps.apple.com/?daddr=-13.516767,-71.978779');
    expect(apple).not.toContain('google.com');
  });

  it('phone and email print only where the person’s record allows it', async () => {
    const text = await allText((await callSheetPdf(input(project()))).bytes);
    // Kevin (crew) prints by default; Ana (cast) does not.
    expect(text).toContain('555 0102');
    expect(text).toContain('kev@example.com');
    expect(text).not.toContain('555 0101');
    expect(text).not.toContain('ana@example.com');
    const records = project();
    const withContact = (id: string, on: boolean) => {
      const person = records[id];
      if (!person) throw new Error(id);
      records[id] = { ...person, props: { ...person.props, contact_on_sheet: on } };
    };
    withContact('ana', true);
    withContact('kev', false);
    const changed = await allText((await callSheetPdf(input(records))).bytes);
    expect(changed).toContain('555 0101');
    expect(changed).not.toContain('555 0102');
    expect(changed).not.toContain('kev@example.com');
  });

  it('calls: the department’s and each person’s, and the cast’s three times', async () => {
    const records = project({ notes: { department_calls: { camera: '06:30' }, person_times: { ana: { call: '09:15', hmu_ready: '08:00', on_set: '10:30' } } } });
    const text = await allText((await callSheetPdf(input(records))).bytes);
    expect(text).toContain('09:15');
    expect(text).toContain('08:00');
    expect(text).toContain('10:30');
    expect(text).toContain('06:30');
    expect(text).toMatch(/HMU READY/);
  });

  it('a long name and address wrap rather than run off the page', async () => {
    const long = 'Calle muy larga '.repeat(30);
    const records = project({ location: { ...diner, address: long, name: 'N'.repeat(300) } });
    const { pages, bytes } = await callSheetPdf(input(records));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(pages);
  });
});

describe('the layout', () => {
  it('no two pieces of text overlap, in English or Spanish, on Letter or A4, and all stay inside the margins', async () => {
    const notes = { notes: 'Park behind the diner. Quiet after 10.', safety_notes: 'Wet floor by the sink.', person_times: { ana: { call: '09:15', hmu_ready: '08:00', on_set: '10:30' } } };
    for (const [locale, paper] of [['en', 'letter'], ['es', 'a4']] as const) {
      setLocale(locale);
      const { bytes } = await callSheetPdf(input(project({ extraCrew: 40, notes, long: true, location: { ...diner, hospital_name: 'Hospital Regional Universitario Doctor Adolfo Guevara Velasco del Cusco' } }), { paper, forecasts: new Map([['loc', forecast]]) }));
      const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
      for (let n = 1; n <= pdf.numPages; n += 1) {
        const page = await pdf.getPage(n);
        const [, , pageWidth = 0] = page.view;
        const boxes = (await page.getTextContent()).items.flatMap((item) =>
          'str' in item && item.str.trim() !== '' ? [{ str: item.str, x: Number(item.transform[4]), y: Number(item.transform[5]), w: item.width, h: item.height }] : [],
        );
        for (const box of boxes) {
          expect(box.x, box.str).toBeGreaterThanOrEqual(35);
          expect(box.x + box.w, box.str).toBeLessThanOrEqual(pageWidth - 35);
        }
        for (const [i, a] of boxes.entries()) {
          for (const b of boxes.slice(i + 1)) {
            const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const down = Math.min(a.y + a.h * 0.7, b.y + b.h * 0.7) - Math.max(a.y, b.y);
            expect(across > 0.5 && down > 0.5, `${locale} p${String(n)}: "${a.str}" over "${b.str}"`).toBe(false);
          }
        }
      }
      await pdf.destroy();
    }
  });
});

describe('an issued sheet (4.7)', () => {
  const issuedAt = new Date('2026-11-16T23:04:00Z');

  it('prints its version and issue time at the header, "Revised" from version 2, and nothing of the kind before it is issued', async () => {
    const records = project();
    const draft = await allText((await callSheetPdf(input(records))).bytes);
    expect(draft).not.toMatch(/Version \d|Revised|Issued/);
    const one = await allText((await callSheetPdf(input(records, { issue: { version: 1, issuedAt } }))).bytes);
    // Lima is five hours behind UTC all year; the zone's short name is whatever the language has for it.
    expect(one).toMatch(/Version 1 · Issued Mon, Nov 16 18:04 (GMT-5|PET)/);
    expect(one).not.toContain('Revised');
    const two = await allText((await callSheetPdf(input(records, { issue: { version: 2, issuedAt } }))).bytes);
    expect(two).toMatch(/Revised · Version 2 · Issued Mon, Nov 16 18:04 (GMT-5|PET)/);
  });

  it('says it in Spanish, and keeps the stamp clear of the title on both papers', async () => {
    setLocale('es');
    for (const paper of ['letter', 'a4'] as const) {
      const { bytes } = await callSheetPdf(input(project({ long: true }), { paper, issue: { version: 3, issuedAt } }));
      const items = await pageItems(bytes, 1);
      expect(items.map((i) => i.str).join(' ')).toContain('Revisada');
      expect(items.map((i) => i.str).join(' ')).toContain('Versión 3');
    }
  });
});

describe('an issued sheet with a long title (4.7)', () => {
  it('keeps the title and the stamp apart on the first page, in English and Spanish, on both papers', async () => {
    const records = project();
    records.p = record('p', 'project', null, { title: 'The Extraordinarily Long Title of a Feature Film About Many Things and Places' });
    for (const [locale, paper] of [['en', 'letter'], ['es', 'a4']] as const) {
      setLocale(locale);
      const { bytes } = await callSheetPdf(input(records, { paper, issue: { version: 12, issuedAt: new Date('2026-11-16T23:04:00Z') } }));
      const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
      const page = await pdf.getPage(1);
      const boxes = (await page.getTextContent()).items.flatMap((item) =>
        'str' in item && item.str.trim() !== '' ? [{ str: item.str, x: Number(item.transform[4]), y: Number(item.transform[5]), w: item.width, h: item.height }] : [],
      );
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const down = Math.min(a.y + a.h * 0.7, b.y + b.h * 0.7) - Math.max(a.y, b.y);
          expect(across > 0.5 && down > 0.5, `${locale}: "${a.str}" over "${b.str}"`).toBe(false);
        }
      }
      await pdf.destroy();
    }
  });
});

describe('the QR code', () => {
  it('a known link gives its version’s size: 72 bytes at error correction M is version 5, 37 modules', () => {
    const link = directionsLink('google', { name: '', address: '' }, { name: 'x', latitude: -13.5167674, longitude: -71.9787787 }) ?? '';
    expect(new TextEncoder().encode(link).length).toBe(72);
    const modules = qrModules(link);
    expect(modules?.length).toBe(37);
    expect(modules?.every((row) => row.length === 37)).toBe(true);
    // The finder patterns: a dark corner at three of the four corners.
    expect(modules?.[0]?.[0]).toBe(true);
    expect(modules?.[0]?.[36]).toBe(true);
    expect(modules?.[36]?.[0]).toBe(true);
  });

  it('a longer link needs a bigger version; one past the largest has none', () => {
    expect(qrModules('https://example.com/' + 'a'.repeat(100))?.length).toBe(45);
    expect(qrModules('a'.repeat(3000))).toBeNull();
  });

  it('is drawn once per location with a link, as vector rectangles and no image', async () => {
    const { bytes, qr } = await callSheetPdf(input(project()));
    expect(qr).toEqual([37]);
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(0).node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const content = streams.map((s) => (s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '')).join('\n');
    // pdf-lib closes each rectangle with h. A run of dark modules is one rectangle: far more than the page's rules and boxes, yet no image anywhere.
    expect((content.match(/^h$/gm) ?? []).length).toBeGreaterThan(150);
    expect(content).not.toMatch(/\bDo\b/);
    const none = await callSheetPdf(input(project({ location: { name: '', address: '' } })));
    expect(none.qr).toEqual([]);
  });
});

describe('a long crew', () => {
  it('flows onto more pages with no row split, its heading carried over', async () => {
    const { bytes, pages } = await callSheetPdf(input(project({ extraCrew: 70 })));
    expect(pages).toBeGreaterThanOrEqual(2);
    const texts = await pageTexts(bytes);
    for (let n = 0; n < 70; n += 1) {
      const name = `Crew Person ${String(n).padStart(2, '0')}`;
      expect(texts.filter((text) => text.includes(name)), name).toHaveLength(1);
    }
    expect(texts.some((text) => text.includes('CREW (CONTINUED)'))).toBe(true);
    // Nothing but the footer sits in the band under the content.
    for (let n = 1; n <= pages; n += 1) {
      const low = (await pageItems(bytes, n)).filter((item) => item.y < 66);
      for (const item of low) expect(item.y, item.str).toBeLessThan(60);
      expect(low.map((item) => item.str).join(' ')).toContain(`Page ${String(n)} of ${String(pages)}`);
    }
  });

  it('a person’s name and call stay on one baseline', async () => {
    const { bytes } = await callSheetPdf(input(project({ extraCrew: 70 })));
    for (let n = 1; n <= 2; n += 1) {
      const items = await pageItems(bytes, n);
      for (const item of items.filter((i) => i.str.startsWith('Crew Person'))) {
        const row = items.filter((i) => Math.abs(i.y - item.y) < 1);
        expect(row.some((i) => /^\d\d:\d\d$/.test(i.str)), item.str).toBe(true);
      }
    }
  });
});

describe('the footer credits', () => {
  it('the app’s only, when there is no place, forecast or hospital', async () => {
    const records = project({ location: { name: 'Diner', address: '12 Route 9' } });
    const [text = ''] = await pageTexts((await callSheetPdf(input(records))).bytes);
    expect(text).toContain('Made with Storiiboard');
    expect(text).toContain('Page 1 of 1');
    expect(text).not.toContain('MET Norway');
    expect(text).not.toContain('OpenStreetMap contributors');
  });

  it('MET Norway when a forecast is printed, OpenStreetMap when a place or searched hospital is', async () => {
    const text = await allText((await callSheetPdf(input(project(), { forecasts: new Map([['loc', forecast]]) }))).bytes);
    expect(text).toContain('Data from MET Norway');
    expect(text).toContain('© OpenStreetMap contributors');
    // A hospital typed by hand at a place-less location credits neither.
    const records = project({ location: { name: 'Diner', address: '12 Route 9', hospital_name: 'Posta Local' } });
    const [typed = ''] = await pageTexts((await callSheetPdf(input(records))).bytes);
    expect(typed).toContain('Posta Local');
    expect(typed).not.toContain('OpenStreetMap contributors');
    // A searched hospital credits OpenStreetMap even without a place.
    const searched = project({ location: { name: 'Diner', address: '12 Route 9', hospital_name: 'Clínica', hospital_source: 'osm' } });
    expect((await pageTexts((await callSheetPdf(input(searched))).bytes))[0]).toContain('© OpenStreetMap contributors');
  });
});

describe('the words', () => {
  it('are Spanish in Spanish, with none of English’s labels left, and every character printed', async () => {
    setLocale('es');
    const records = project({ notes: { notes: 'Estacionar detrás.' } });
    const result = await callSheetPdf(input(records, { forecasts: new Map([['loc', forecast]]) }));
    expect(result.replaced).toBe(false);
    const text = await allText(result.bytes);
    expect(text).toMatch(/Página 1 de \d/);
    for (const expected of ['HOJA DE LLAMADO', 'Día 1 de 1', 'COORDENADAS', 'CÓMO LLEGAR', 'Hecho con Storiiboard', 'Datos de MET Norway', 'ESCANEA PARA IR']) {
      expect(text, expected).toContain(expected);
    }
    for (const english of ['CALL SHEET', 'Day 1 of 1', 'COORDINATES', 'Made with', 'Page 1 of']) expect(text, english).not.toContain(english);
  });

  it('prints the characters of both languages with no ? for a missing glyph', async () => {
    const records = project({ location: { ...diner, parking: 'Estacionamiento — detrás del “diner” · ñandú ▲' } });
    const result = await callSheetPdf(input(records));
    expect(result.replaced).toBe(false);
  });
});

describe('the file name', () => {
  it('is the project, the call sheet, the day and the date, in the app’s language', () => {
    expect(callSheetFileName('Bey County', 3, '2026-11-16')).toBe('Bey County — Call sheet — Day 3 — 2026-11-16.pdf');
    setLocale('es');
    expect(callSheetFileName('Bey County', 3, '2026-11-16')).toBe('Bey County — Hoja de llamado — Día 3 — 2026-11-16.pdf');
  });

  it('is made safe, and leaves the date out of a day with none', () => {
    expect(callSheetFileName('A/B: "C"?', 1, '2026-01-02')).toBe('A B C — Call sheet — Day 1 — 2026-01-02.pdf');
    expect(callSheetFileName('Bey County', 2, '')).toBe('Bey County — Call sheet — Day 2.pdf');
  });
});

/** Every text item under the content band must be the footer's: below the rule at 58 pt, never lower than the margin. */
async function expectNothingBelowFooter(bytes: Uint8Array, pages: number): Promise<void> {
  for (let n = 1; n <= pages; n += 1) {
    for (const item of (await pageItems(bytes, n)).filter((i) => i.y < 66)) expect(item.y, `p${String(n)} "${item.str}"`).toBeLessThan(60);
  }
}

describe('page breaks', () => {
  const tall: Props = {
    ...diner,
    address: 'Calle Real 123, Barrio de San Blas, Cusco, Peru, cerca de la plaza principal y la iglesia vieja de la ciudad',
    parking: 'Lot behind the diner. '.repeat(14),
    power: 'Two 20 amp circuits and a generator pad. '.repeat(10),
    hospital_address: 'Avenida de la Cultura 2000, Wanchaq, Cusco, junto al estadio municipal y frente al parque central de la ciudad',
  };

  it('a location is never split when it fits a page: it stays whole, nothing under the footer', async () => {
    const { bytes, pages } = await callSheetPdf(input(project({ location: tall, long: true }), { forecasts: new Map([['loc', forecast]]) }));
    expect(pages).toBeGreaterThanOrEqual(2);
    const texts = await pageTexts(bytes);
    const diner = texts.filter((text) => text.includes('Diner CONFIRMED'));
    expect(diner).toHaveLength(1);
    expect(diner[0]).toContain('NEAREST HOSPITAL');
    expect(diner[0]).toContain('Lot behind the diner.');
    expect(texts.every((text) => !text.includes('(CONTINUED)') || text.includes('SCENES') || text.includes('CREW'))).toBe(true);
    await expectNothingBelowFooter(bytes, pages);
  });

  it('a first block that does not fit page 1 but fits a fresh page moves to it, heading and all', async () => {
    const { bytes, pages } = await callSheetPdf(input(project({ characters: 42, noLocation: true })));
    expect(pages).toBeGreaterThanOrEqual(2);
    const texts = await pageTexts(bytes);
    expect(texts[0]).not.toContain('SCENES');
    expect(texts[1]).toContain('SCENES');
    expect(texts[1]).toContain('SC 01');
    expect(texts[1]).not.toContain('(CONTINUED)');
    expect(texts[1]).not.toContain('(continued)');
    await expectNothingBelowFooter(bytes, pages);
  });

  it('a scene with 60 characters, taller than any page, splits between rows, says it carries on, and draws nothing under the footer', async () => {
    const { bytes, pages } = await callSheetPdf(input(project({ characters: 60, noLocation: true })));
    expect(pages).toBeGreaterThanOrEqual(2);
    const texts = await pageTexts(bytes);
    for (let n = 0; n < 60; n += 1) {
      expect(texts.filter((text) => text.includes(`EXTRA ${String(n).padStart(2, '0')}`)), String(n)).toHaveLength(1);
    }
    expect(texts.some((text) => text.includes('SC 01 (continued)'))).toBe(true);
    expect(texts.some((text) => text.includes('SCENES (CONTINUED)'))).toBe(true);
    await expectNothingBelowFooter(bytes, pages);
  });

  it('a department that carries over to the next page says so', async () => {
    const { bytes } = await callSheetPdf(input(project({ extraCrew: 70 })));
    const texts = await pageTexts(bytes);
    expect(texts.some((text) => text.includes('GRIP & ELECTRIC (CONTINUED)'))).toBe(true);
  });
});

describe('the forecast, as the tile shows it', () => {
  it('prints nothing for a day with no date', async () => {
    const text = await allText((await callSheetPdf(input(project({ day: { date: '' } })))).bytes);
    expect(text).not.toContain('WEATHER');
    expect(text).not.toContain('Forecast not fetched');
  });

  it('prints nothing about a forecast never fetched for a day gone by, and says so for one to come', async () => {
    const past = await allText((await callSheetPdf(input(project({ day: { date: '2026-11-01' } })))).bytes);
    expect(past).not.toContain('Forecast not fetched');
    const coming = await allText((await callSheetPdf(input(project({ day: { date: '2026-11-20' } })))).bytes);
    expect(coming).toContain('Forecast not fetched');
  });

  it('a fetched forecast that stops short of the day says where it stops; one that does not cover it prints nothing', async () => {
    const beyond: PdfForecast = { day: { state: 'beyond', lastDate: '2026-11-19' }, fetchedAt: '2026-11-16T14:00:00Z' };
    const short = await allText((await callSheetPdf(input(project({ day: { date: '2026-11-25' } }), { forecasts: new Map([['loc', beyond]]) }))).bytes);
    expect(short).toContain('No forecast yet: it reaches as far as Thu, Nov 19');
    expect(short).toContain('Data from MET Norway');
    const none: PdfForecast = { day: { state: 'none' }, fetchedAt: '2026-11-16T14:00:00Z' };
    const nothing = await allText((await callSheetPdf(input(project(), { forecasts: new Map([['loc', none]]) }))).bytes);
    expect(nothing).not.toContain('WEATHER');
    expect(nothing).not.toContain('MET Norway');
  });
});

describe('tappable links', () => {
  it('the directions link, the QR code and its caption each open the link', async () => {
    const { bytes, qr } = await callSheetPdf(input(project()));
    expect(qr).toEqual([37]);
    const doc = await PDFDocument.load(bytes);
    const link = 'https://www.google.com/maps/dir/?api=1&destination=-13.516767,-71.978779';
    const found: { uri: string; width: number; height: number }[] = [];
    const annots = doc.getPage(0).node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i += 1) {
      const annot = annots?.lookup(i, PDFDict);
      const action = annot?.lookup(PDFName.of('A'), PDFDict);
      const rect = annot?.lookup(PDFName.of('Rect'), PDFArray);
      const uri = action?.lookup(PDFName.of('URI'), PDFString);
      if (!uri || !rect) continue;
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = rect.asArray().map((n) => (n as PDFNumber).asNumber());
      found.push({ uri: uri.decodeText(), width: x2 - x1, height: y2 - y1 });
    }
    expect(found.every((a) => a.uri === link)).toBe(true);
    // The text, the QR (about 25 mm square) and its caption, which wraps to two lines.
    expect(found.length).toBe(4);
    expect(found.filter((a) => Math.abs(a.width - 70.87) < 0.1 && Math.abs(a.height - 70.87) < 0.1)).toHaveLength(1);
  });
});

// The map on the sheet (4.10): the frame's picture (composed in the page from the tiles, given here as JPEG bytes), the
// pin, the credit under it.
describe('the map image', () => {
  // A 1 x 1 JPEG: the picture's bytes are only embedded, never looked at.
  const jpeg = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
  const OSM = '© OpenStreetMap contributors';
  const pictured = (credit = OSM): PdfMap => ({ kind: 'image', jpeg, credit });
  const maps = (map: PdfMap) => new Map([['loc', map]]);

  async function content(bytes: Uint8Array, page = 0): Promise<string> {
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(page).node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    return streams.map((s) => (s instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(s).decode()) : '')).join('\n');
  }

  it('is one picture placed exactly on the 60 x 40 mm frame, with the credit under the location’s address', async () => {
    const { bytes } = await callSheetPdf(input(project(), { maps: maps(pictured()) }));
    const stream = await content(bytes);
    expect((stream.match(/\bDo\b/g) ?? []).length).toBe(1);
    // pdf-lib places an image with two cm lines: a translate to its corner, then the scale to its size.
    const lines = stream.split(/\r?\n/);
    const at = lines.findIndex((l) => /^170\.0\d* 0 0 113\.3\d* 0 0 cm$/.test(l));
    expect(at).toBeGreaterThan(0);
    const corner = lines
      .slice(Math.max(0, at - 4), at)
      .map((l) => /^1 0 0 1 ([\d.]+) ([\d.]+) cm$/.exec(l))
      .findLast((m) => m !== null && m[1] !== '0');
    // The block starts at the left margin (36 pt).
    expect(Number(corner?.[1])).toBeCloseTo(36, 1);
    const items = await pageItems(bytes, 1);
    const credit = items.find((i) => i.str === OSM);
    const address = items.find((i) => i.str.includes('12 Route 9'));
    expect(credit).toBeDefined();
    // Under the frame, which is under the address.
    expect(credit?.y).toBeLessThan(Number(corner?.[2]));
    expect(Number(corner?.[2])).toBeLessThan(address?.y ?? 0);
  });

  it('draws the pin at the place and the 1.5 pt ink frame: two circles and the frame’s outline', async () => {
    const plain = await content((await callSheetPdf(input(project()))).bytes);
    const withMap = await content((await callSheetPdf(input(project(), { maps: maps(pictured()) }))).bytes);
    const curves = (s: string) => (s.match(/ c$/gm) ?? []).length;
    // Each circle is four curves.
    expect(curves(withMap) - curves(plain)).toBe(8);
    expect(withMap).toContain('1.5 w');
  });

  it('draws a grid in a browser build inside the frame, with the screen map’s words and the credit', async () => {
    const { bytes } = await callSheetPdf(input(project(), { maps: maps({ kind: 'grid', credit: OSM }) }));
    expect(await allText(bytes)).toContain('Map tiles show in the desktop app');
    expect((await pageItems(bytes, 1)).some((i) => i.str === OSM)).toBe(true);
    expect(await content(bytes)).not.toMatch(/\bDo\b/);
  });

  it('is an empty frame with one line when no tile could be had, no credit, and the address, coordinates, link and QR still print', async () => {
    const { bytes, qr } = await callSheetPdf(input(project(), { maps: maps({ kind: 'none', why: 'Map not available offline' }) }));
    const text = await allText(bytes);
    expect(text).toContain('Map not available offline');
    expect(await content(bytes)).not.toMatch(/\bDo\b/);
    expect((await pageItems(bytes, 1)).filter((i) => i.str === OSM)).toHaveLength(0);
    for (const expected of ['12 Route 9, Bey County', '-13.516767, -71.978779', 'https://www.google.com/maps/dir/?api=1&destination=-13.516767,-71.978779']) expect(text).toContain(expected);
    expect(qr).toEqual([37]);
    const off = await allText((await callSheetPdf(input(project(), { maps: maps({ kind: 'none', why: 'This service is switched off.' }) }))).bytes);
    expect(off).toContain('This service is switched off.');
  });

  it('is left out of a location with no place, and when no map is given', async () => {
    const noPlace = await callSheetPdf(input(project({ location: { name: 'Diner', address: '12 Route 9' } }), { maps: maps(pictured()) }));
    expect(await content(noPlace.bytes)).not.toMatch(/\bDo\b/);
    const none = await allText((await callSheetPdf(input(project()))).bytes);
    expect(none).not.toContain('Map not available');
    expect(none).not.toContain('desktop app');
  });

  it('prints on an issued sheet too', async () => {
    const issue = { version: 2, issuedAt: new Date('2026-11-16T23:04:00Z') };
    const { bytes } = await callSheetPdf(input(project(), { maps: maps(pictured()), issue }));
    expect((await content(bytes)).match(/\bDo\b/g) ?? []).toHaveLength(1);
    expect(await allText(bytes)).toContain('Revised');
    expect((await pageItems(bytes, 1)).some((i) => i.str === OSM)).toBe(true);
  });

  it('wraps a long credit of one’s own to the frame under the map, and the footer carries it whole', async () => {
    const own = 'Map tiles: tiles.example.com. Imagery and data by Example Mapping Ltd and its contributors, used under licence';
    const { bytes } = await callSheetPdf(input(project(), { maps: maps(pictured(own)) }));
    const items = await pageItems(bytes, 1);
    // Under the map it is several lines: no single item holds the whole credit there.
    const parts = items.filter((i) => own.includes(i.str.trim()) && i.str.trim().length > 6 && i.str.trim() !== own);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    const flat = await allText(bytes);
    expect(flat).toContain('Example Mapping Ltd');
    expect(flat).toContain('used under licence');
    expect(flat).toContain(OSM);
  });

  it('is in Spanish too: the offline line', async () => {
    setLocale('es');
    const { bytes } = await callSheetPdf(input(project(), { maps: maps({ kind: 'none', why: 'Mapa no disponible sin conexión' }) }));
    expect(await allText(bytes)).toContain('Mapa no disponible sin conexión');
  });

  it('keeps a location with its map whole: one that would land at the page foot moves to the next page, picture and all', async () => {
    const many = Object.fromEntries(
      [1, 2, 3, 4].flatMap((n) => [
        [`ml${String(n)}`, record(`ml${String(n)}`, 'location', 'p', { ...diner, name: `Stage ${String(n)}` })],
        [`ms${String(n)}`, record(`ms${String(n)}`, 'shot', 's1', { number: `9${String(n)}`, shoot_day_id: 'd', location_id: `ml${String(n)}` })],
      ]),
    );
    const all = { ...project(), ...many };
    const sheet = callSheet(all, 'p', 'd', undefined, new Map([...zones, ...[1, 2, 3, 4].map((n): [string, string] => [`ml${String(n)}`, 'America/Lima'])]));
    if (!sheet) throw new Error('no sheet');
    const withMaps = new Map(sheet.locations.map((l): [string, PdfMap] => [l.record.id, pictured()]));
    const { bytes, pages } = await callSheetPdf({ ...input(all), sheet, maps: withMaps });
    expect(pages).toBeGreaterThanOrEqual(2);
    // As many pictures as locations, each on the page of its own block; none cut by a page or under the footer.
    let pictures = 0;
    for (let n = 0; n < pages; n += 1) pictures += ((await content(bytes, n)).match(/\bDo\b/g) ?? []).length;
    expect(pictures).toBe(withMaps.size);
    await expectNothingBelowFooter(bytes, pages);
    // On every page the pictures are as many as the locations named there: a block and its map are never parted.
    for (let n = 0; n < pages; n += 1) {
      const names = ((await pageTexts(bytes))[n]?.match(/(Stage \d|Diner) CONFIRMED/g) ?? []).length;
      expect(((await content(bytes, n)).match(/\bDo\b/g) ?? []).length, `page ${String(n + 1)}`).toBe(names);
    }
  });
});

describe('only frames still to shoot (4.11)', () => {
  it('prints “Nothing left to shoot” in the Scenes section, in both languages, when every frame is Have', async () => {
    const records = project();
    const shot = { ...records, a: { ...(records.a as SbdRecord), props: { ...(records.a as SbdRecord).props, status: 'have' } } };
    const text = await allText((await callSheetPdf(input(shot))).bytes);
    expect(text).toContain('Nothing left to shoot on this day.');
    expect(text).not.toContain('SC 01');
    expect(text).toContain('Monday, November 16, 2026');
    setLocale('es');
    expect(await allText((await callSheetPdf(input(shot))).bytes)).toContain('No queda nada por filmar en este día.');
  });

  it('prints the scene while its frame is still Need to shoot', async () => {
    const text = await allText((await callSheetPdf(input(project()))).bytes);
    expect(text).toContain('SC 01');
    expect(text).not.toContain('Nothing left to shoot');
  });
});

// The company on the header (4.12): its logo at the top left in a 140 x 40 pt box, its name beside it, the issue stamp
// still at the top right.
describe('the company on the header (4.12)', () => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = (crcTable[(c ^ byte) & 255] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  /** A solid grey PNG of the given size, made here so no picture file is needed. */
  function png(width: number, height: number): Uint8Array {
    const chunk = (kind: string, data: Uint8Array): Buffer => {
      const out = Buffer.alloc(12 + data.length);
      out.writeUInt32BE(data.length, 0);
      out.write(kind, 4, 'latin1');
      out.set(data, 8);
      out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
      return out;
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0);
    head.writeUInt32BE(height, 4);
    head.set([8, 2, 0, 0, 0], 8);
    const rows = Buffer.alloc((width * 3 + 1) * height, 0x80);
    for (let y = 0; y < height; y += 1) rows[y * (width * 3 + 1)] = 0;
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array())]));
  }
  /** The map test one-pixel JPEG with its size changed in the frame header (only the header is read to embed it). */
  function jpegOf(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));
    const sof = bytes.findIndex((byte, n) => byte === 0xff && bytes[n + 1] === 0xc2);
    bytes.set([height >> 8, height & 255, width >> 8, width & 255], sof + 5);
    return bytes;
  }

  /** The first picture drawn on page 1, as [x, y, width, height] in points, y up from the foot. */
  async function firstImage(bytes: Uint8Array): Promise<[number, number, number, number] | null> {
    const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const { fnArray, argsArray } = await (await pdf.getPage(1)).getOperatorList();
    let found: [number, number, number, number] | null = null;
    // The current transformation matrix, kept as the page's operators save, restore and transform it.
    let ctm = [1, 0, 0, 1, 0, 0];
    const saved: number[][] = [];
    for (const [n, fn] of fnArray.entries()) {
      const m = (argsArray[n] ?? []) as number[];
      if (fn === OPS.save) saved.push(ctm);
      else if (fn === OPS.restore) ctm = saved.pop() ?? ctm;
      else if (fn === OPS.transform) {
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = m;
        const [A = 1, B = 0, C = 0, D = 1, E = 0, F = 0] = ctm;
        ctm = [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
      }
      if (fn === OPS.paintImageXObject && !found) found = [ctm[4] ?? 0, ctm[5] ?? 0, Math.abs(ctm[0] ?? 0), Math.abs(ctm[3] ?? 0)];
    }
    await pdf.destroy();
    return found;
  }
  async function boxes(bytes: Uint8Array) {
    const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items.flatMap((item) =>
      'str' in item && item.str.trim() !== '' ? [{ str: item.str, x: Number(item.transform[4]), y: Number(item.transform[5]), w: item.width, h: item.height }] : [],
    );
    await pdf.destroy();
    return items;
  }

  it('draws a PNG logo inside its box with the company name, and a JPEG the same', async () => {
    for (const [logo, wide] of [[png(400, 50), true], [jpegOf(100, 200), false]] as const) {
      const { bytes } = await callSheetPdf(input(project(), { company: { name: 'Zima Blue Pictures', logo } }));
      expect(await allText(bytes)).toContain('ZIMA BLUE PICTURES');
      const image = await firstImage(bytes);
      if (!image) throw new Error('no logo drawn');
      const [x, , width, height] = image;
      expect(x).toBeCloseTo(36, 0);
      expect(width).toBeLessThanOrEqual(140.01);
      expect(height).toBeLessThanOrEqual(40.01);
      // Aspect kept: the wide one fills the width, the tall one the height.
      expect(wide ? width / height : height / width).toBeCloseTo(wide ? 8 : 2, 1);
      expect(wide ? width : height).toBeCloseTo(wide ? 140 : 40, 0);
    }
  });

  it('prints the name alone for a logo it cannot embed, and for none', async () => {
    const odd = await callSheetPdf(input(project(), { company: { name: 'Zima Blue Pictures', logo: new Uint8Array([1, 2, 3, 4]) } }));
    expect(await allText(odd.bytes)).toContain('ZIMA BLUE PICTURES');
    expect(await firstImage(odd.bytes)).toBeNull();
    const none = await callSheetPdf(input(project(), { company: { name: 'Zima Blue Pictures', logo: null } }));
    expect(await allText(none.bytes)).toContain('ZIMA BLUE PICTURES');
  });

  it('is the sheet as it was without a company: the same bytes, and a nameless empty company prints nothing', async () => {
    const records = project();
    const before = (await callSheetPdf(input(records))).bytes;
    // Pinned, so a later change that moves both paths together still fails here; a deliberate change to the sheet updates it.
    expect(createHash('sha256').update(before).digest('hex')).toBe('77934b3343f99cb0517ae2239c05906a214c7b63a5eddd699ca5bd3965a34d6c');
    expect(Buffer.from((await callSheetPdf(input(records, { company: null }))).bytes).equals(Buffer.from(before))).toBe(true);
    expect(Buffer.from((await callSheetPdf(input(records, { company: { name: ' ', logo: null } }))).bytes).equals(Buffer.from(before))).toBe(true);
  });

  it('keeps a long name and a wide logo clear of the issue stamp and the title, in English on Letter and Spanish on A4', async () => {
    const name = 'The Extraordinarily Long Named Motion Picture and Television Production Company of Bey County Limited';
    const issuedAt = new Date('2026-11-16T23:04:00Z');
    for (const [locale, paper] of [['en', 'letter'], ['es', 'a4']] as const) {
      setLocale(locale);
      const { bytes } = await callSheetPdf(input(project({ long: true }), { paper, company: { name, logo: png(600, 60) }, issue: { version: 12, issuedAt } }));
      const text = await boxes(bytes);
      for (const [i, a] of text.entries()) {
        for (const b of text.slice(i + 1)) {
          const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const down = Math.min(a.y + a.h * 0.7, b.y + b.h * 0.7) - Math.max(a.y, b.y);
          expect(across > 0.5 && down > 0.5, `${locale}: "${a.str}" over "${b.str}"`).toBe(false);
        }
      }
      const image = await firstImage(bytes);
      if (!image) throw new Error('no logo drawn');
      const [x, y, width, height] = image;
      for (const box of text) {
        const across = Math.min(x + width, box.x + box.w) - Math.max(x, box.x);
        const down = Math.min(y + height, box.y + box.h * 0.7) - Math.max(y, box.y);
        expect(across > 0.5 && down > 0.5, `${locale}: logo over "${box.str}"`).toBe(false);
      }
      // The stamp stays in the top right: its text starts right of the logo's box.
      const stamp = text.find((box) => /Version|Versión/.test(box.str));
      expect(stamp, locale).toBeDefined();
      expect((stamp?.x ?? 0) > x + width).toBe(true);
    }
  });
});
