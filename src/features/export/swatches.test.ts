import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { STRIP_WIDTH, drawStrip, stripLayout } from './swatchesPng';
import { swatchFileName, swatchSet } from './swatchSet';
import { swatchesAse } from './swatchesAse';

// The swatches exports (5.6b): the PNG strip's size and order, the names in en and es, the colours of a scene and of the brand kit.

afterEach(() => {
  setLocale('en');
});

describe('the PNG strip', () => {
  it('is 2400 wide with equal swatches side by side, in order, inside the margins', () => {
    for (const count of [1, 5, 16]) {
      const layout = stripLayout(count);
      expect(layout.width).toBe(STRIP_WIDTH);
      expect(layout.swatches).toHaveLength(count);
      const widths = new Set(layout.swatches.map((s) => s.width));
      expect(widths.size).toBe(1);
      layout.swatches.forEach((box, i) => {
        if (i > 0) expect(box.x).toBe((layout.swatches[i - 1]?.x ?? 0) + box.width);
      });
      const last = layout.swatches.at(-1);
      expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(STRIP_WIDTH - 80);
      expect(layout.height).toBeGreaterThan(layout.swatches[0]?.y ?? 0);
    }
  });

  it('draws paper first, then each colour in order with its hex under it, in ink', () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: '',
      textBaseline: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
      fillRect() {
        calls.push(`rect ${this.fillStyle}`);
      },
      strokeRect() {},
      fillText(text: string) {
        calls.push(`text ${this.fillStyle} ${this.font.includes('JetBrains Mono') ? 'mono' : 'ui'} ${text}`);
      },
    };
    drawStrip(ctx as unknown as CanvasRenderingContext2D, { label: 'SC 04', title: 'INT. KITCHEN - NIGHT' }, ['#DF5E27', '#1B2632']);
    expect(calls).toEqual([
      'rect #EEE9DF',
      'text #16150F mono SC 04',
      'text #16150F ui INT. KITCHEN - NIGHT',
      'rect #DF5E27',
      'text #16150F mono #DF5E27',
      'rect #1B2632',
      'text #16150F mono #1B2632',
    ]);
  });
});

describe('file names', () => {
  it('follow the app’s language, with the safe-name rules', () => {
    expect(swatchFileName('SC 04', 'png')).toBe('SC 04 palette.png');
    expect(swatchFileName('SC 04', 'ase')).toBe('SC 04 palette.ase');
    expect(swatchFileName('Acme: Films/Co', 'png')).toBe('Acme Films Co palette.png');
    setLocale('es');
    expect(swatchFileName('ESC 04', 'ase')).toBe('paleta de ESC 04.ase');
  });
});

describe('what a source offers', () => {
  const records: Record<string, SbdRecord> = {
    p: {
      id: 'p',
      type: 'project',
      parentId: null,
      sortKey: 'a',
      trashedAt: null,
      trashedBy: null,
      props: { company: { profile_id: 'c', name: 'Acme Films', brand_colors: ['#df5e27', '#1B2632', 'nope'] } },
    } as unknown as SbdRecord,
    s: {
      id: 's',
      type: 'scene',
      parentId: 'p',
      sortKey: 'a',
      trashedAt: null,
      trashedBy: null,
      props: { number: '4', name: 'Kitchen', int_ext: 'INT', day_night: 'NIGHT', palette: { size: 8, colors: [{ hex: '#A35139' }, { hex: '#1F2F4D', locked: true }] } },
    } as unknown as SbdRecord,
  };
  beforeEach(() => {
    setLocale('en');
  });

  it('a scene’s palette in order, headed by its number and heading', () => {
    const set = swatchSet(records, 'p', { kind: 'scene', sceneId: 's' });
    expect(set?.hexes).toEqual(['#A35139', '#1F2F4D']);
    expect(set?.name).toBe('SC 04');
    expect(set?.heading.startsWith('SC 04')).toBe(true);
  });

  it('the brand kit’s colours under the company’s name; none without a company', () => {
    expect(swatchSet(records, 'p', { kind: 'brand' })).toEqual({ name: 'Acme Films', heading: 'Acme Films', parts: { label: '', title: 'Acme Films' }, hexes: ['#DF5E27', '#1B2632'] });
    expect(swatchSet({ ...records, p: { ...(records.p as SbdRecord), props: {} } }, 'p', { kind: 'brand' })).toBeNull();
  });

  it('a scene in the Trash offers nothing', () => {
    expect(swatchSet({ ...records, s: { ...(records.s as SbdRecord), trashedAt: 'now' } }, 'p', { kind: 'scene', sceneId: 's' })).toBeNull();
  });

  it('the .ase format writes a file named for the scene with its colours, and refuses an empty palette', async () => {
    const written: { name: string; bytes: Uint8Array }[] = [];
    const base = {
      records,
      projectId: 'p',
      title: 'SC 04',
      scope: { kind: 'project' as const },
      file: undefined as never,
      target: { label: 'x', write: (name: string, bytes: Uint8Array) => Promise.resolve(void written.push({ name, bytes })) },
      progress: () => undefined,
      signal: new AbortController().signal,
    };
    const result = await swatchesAse.run({ ...base, swatches: { kind: 'scene', sceneId: 's' } });
    expect(result.what).toBe('2 colours');
    expect(written[0]?.name).toBe('SC 04 palette.ase');
    expect(String.fromCharCode(...(written[0]?.bytes.slice(0, 4) ?? []))).toBe('ASEF');
    const empty = { ...records, s: { ...(records.s as SbdRecord), props: { number: '4' } } };
    await expect(swatchesAse.run({ ...base, records: empty, swatches: { kind: 'scene', sceneId: 's' } })).rejects.toThrow();
  });
});
