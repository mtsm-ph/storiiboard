import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PreparedImage } from '../../core/media/store';
import type { Props, SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import { attachCompany } from './companyEdits';

// A company's logo attached past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the app
// throw): after the last key that can be read; a sound project's key is keyBetween's, as before.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

function logo(seed: number): PreparedImage {
  const bytes = new Uint8Array(300).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png', width: 512, height: 128, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 100), mime: 'image/jpeg', width: 512, height: 128, longEdge: 512 },
  };
}

describe('a company logo past an odd key (6.23)', () => {
  it('goes after the last readable key; a sound project’s key as before', () => {
    const profile = { id: 'co1', name: 'Zima Blue Pictures', address: '', phone: '', email: '', website: '', logo: 'data:image/png;base64,AA==', brandColors: [], brandFonts: [] };
    const keyOf = (records: Record<string, SbdRecord>) => {
      const made = attachCompany(records, 'p', profile, logo(3), '/Films/Odd.sbd').changes.find((c) => c.kind === 'create');
      return made?.kind === 'create' ? made.record.sortKey : null;
    };
    const project = record('p', 'project', null, { title: 'Odd' });
    expect(keyOf(recordsOf(project, record('m1', 'media', 'p', { kind: 'link' }, 'b'), record('m2', 'media', 'p', { kind: 'link' }, '~')))).toBe(keyBetween('b', null));
    expect(keyOf(recordsOf(project, record('m1', 'media', 'p', { kind: 'link' }, 'b'), record('m2', 'media', 'p', { kind: 'link' }, 'd')))).toBe(keyBetween('d', null));
  });
});
