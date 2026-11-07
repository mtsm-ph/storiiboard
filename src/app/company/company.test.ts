import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../core/media/store';
import { projectCompany } from '../../core/model/company';
import type { SbdRecord } from '../../core/model/record';

// Company profiles (3.2): kept in the app's settings (a full store says so, nothing lost), and attached to a project
// as one edit with its logo, updated and detached the same way.

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const store = { full: false };
  const local = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (store.full) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  return store;
});

const { addCompany, companiesStore, removeCompany, saveCompany } = await import('./companies');
const { attachCompany, COMPANY_LOGO_ROLE, detachCompany, needsLogo } = await import('./companyEdits');
const { describeEdit } = await import('../../features/history/summary');
type LoggedOp = import('../../core/ops/ops').LoggedOp;
const { emptyTrashMessage, oldCompanyLogos, trashItems } = await import('../../features/trash/trash');

const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props'], trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'a',
  props,
  trashedAt,
  trashedBy: null,
  createdAt: '2026-11-07T12:00:00.000Z',
  updatedAt: '2026-11-07T12:00:00.000Z',
});

function logo(seed: number): PreparedImage {
  const bytes = new Uint8Array(300).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png', width: 512, height: 128, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 100), mime: 'image/jpeg', width: 512, height: 128, longEdge: 512 },
  };
}

describe('company profiles on this computer (3.2)', () => {
  it('adds, saves and removes profiles, and says when the settings can’t hold them, changing nothing', () => {
    expect(addCompany()).toBeNull();
    const [blank] = companiesStore.getState().companies;
    if (!blank) throw new Error('the profile');
    // A name of 299 letters and an emoji: kept whole, and read back the same (cut by characters, not code units).
    const long = `${'a'.repeat(299)}🎬`;
    expect(saveCompany({ ...blank, name: long, phone: '+1 212 555 0100' })).toBeNull();
    expect(companiesStore.getState().companies[0]).toMatchObject({ name: long, phone: '+1 212 555 0100' });
    expect(saveCompany({ ...blank, name: '  Zima Blue Pictures  ' })).toBeNull();
    storage.full = true;
    expect(saveCompany({ ...blank, name: 'Lost' })).toBe('notSaved');
    expect(companiesStore.getState().companies[0]?.name).toBe('Zima Blue Pictures');
    storage.full = false;
    // Logos past the shared budget are refused before anything's written.
    const big = `data:image/png;base64,${'A'.repeat(140_000)}`;
    for (let i = 0; i < 4; i += 1) expect(addCompany()).toBeNull();
    const all = companiesStore.getState().companies;
    for (const c of all.slice(0, 4)) expect(saveCompany({ ...c, logo: big })).toBeNull();
    const fifth = all[4];
    if (!fifth) throw new Error('the fifth');
    expect(saveCompany({ ...fifth, logo: big })).toBe('tooManyLogos');
    for (const c of companiesStore.getState().companies) expect(removeCompany(c.id)).toBeNull();
    expect(companiesStore.getState().companies).toEqual([]);
  });
});

describe('a company attached to a project (3.2)', () => {
  const profile = { id: 'co1', name: 'Zima Blue Pictures', address: '', phone: '', email: '', website: 'https://example.com', logo: 'data:image/png;base64,AA==' };
  const base = () => ({ p: record('p', 'project', null, { title: 'Bey County' }) });

  it('copies the profile and its logo in one edit, and attaching again sends the old logo to the Trash', () => {
    const first = attachCompany(base(), 'p', profile, logo(3), '/Films/Bey County.sbd');
    const created = first.changes.find((c) => c.kind === 'create');
    expect(created?.kind === 'create' && created.record.type).toBe('media');
    expect(first.alsoWrite.length).toBeGreaterThan(0);
    const update = first.changes.find((c) => c.kind === 'update');
    const props = update?.kind === 'update' ? (update.set ?? {}) : {};
    const copy = projectCompany(props);
    expect(copy?.name).toBe('Zima Blue Pictures');
    const logoId = copy?.logoId ?? '';
    expect(created?.kind === 'create' && created.record.id).toBe(logoId);

    expect(created?.kind === 'create' && created.record.props?.role).toBe(COMPANY_LOGO_ROLE);

    const now = { ...base(), p: record('p', 'project', null, { title: 'Bey County', ...props }), [logoId]: record(logoId, 'media', 'p', { role: COMPANY_LOGO_ROLE }) };
    // The same logo, the name changed: the logo is kept as it is, not made again.
    expect(needsLogo(now, 'p', { ...profile, name: 'Zima Blue' })).toBe(false);
    const renamed = attachCompany(now, 'p', { ...profile, name: 'Zima Blue' }, null, '/Films/Bey County.sbd');
    expect(renamed.changes.filter((c) => c.kind !== 'update')).toEqual([]);
    const kept = renamed.changes.find((c) => c.kind === 'update');
    expect(projectCompany(kept?.kind === 'update' ? kept.set : {})).toMatchObject({ name: 'Zima Blue', logoId });
    // Its logo taken off the profile: the project's goes to the Trash.
    const plain = attachCompany(now, 'p', { ...profile, logo: null }, null, '/Films/Bey County.sbd');
    expect(plain.changes).toContainEqual({ kind: 'trash', id: logoId });
    const next = plain.changes.find((c) => c.kind === 'update');
    expect(projectCompany(next?.kind === 'update' ? next.set : {})).toMatchObject({ logoId: null });

    // Detached: the copy off, its logo to the Trash.
    expect(detachCompany(now, 'p')).toEqual([
      { kind: 'trash', id: logoId },
      { kind: 'update', id: 'p', unset: ['company'] },
    ]);
    expect(detachCompany(base(), 'p')).toEqual([]);
  });

  it('never trashes a frame, a scene or the project that a hand-edited logo_id names', () => {
    const records = {
      p: record('p', 'project', null, { company: { profile_id: 'co1', name: 'Zima', logo_id: 's1' } }),
      s1: record('s1', 'shot', 'sc', {}),
    };
    expect(detachCompany(records, 'p')).toEqual([{ kind: 'update', id: 'p', unset: ['company'] }]);
    const self = { p: record('p', 'project', null, { company: { profile_id: 'co1', name: 'Zima', logo_id: 'p' } }) };
    expect(detachCompany(self, 'p')).toEqual([{ kind: 'update', id: 'p', unset: ['company'] }]);
    expect(attachCompany(records, 'p', profile, null, '').changes.some((c) => c.kind === 'trash')).toBe(false);
  });

  it('is named in History as attached, updated or detached, by the company’s name, its logo or not', () => {
    const project = (props: SbdRecord['props']) => record('p', 'project', null, props);
    const op = (before: SbdRecord, after: SbdRecord, extra: { kind: 'create' | 'trash'; media: SbdRecord }[] = []): LoggedOp[] => [
      ...extra.map((e): LoggedOp => ({
        id: e.kind,
        seq: 1,
        groupId: 'g',
        groupKind: 'edit',
        recordId: e.media.id,
        kind: e.kind,
        before: e.kind === 'create' ? null : e.media,
        after: e.kind === 'create' ? e.media : { ...e.media, trashedAt: 'now' },
        author: 'Kevin',
        timestamp: '2026-11-07T12:00:00.000Z',
      })),
      { id: 'u', seq: 2, groupId: 'g', groupKind: 'edit', recordId: 'p', kind: 'update', before, after, author: 'Kevin', timestamp: '2026-11-07T12:00:00.000Z' },
    ];
    const logoMedia = record('l1', 'media', 'p', { kind: 'image', file: 'a'.repeat(64), role: COMPANY_LOGO_ROLE });
    const copy = { profile_id: 'co1', name: 'Zima Blue Pictures', logo_id: 'l1' };
    const text = (ops: LoggedOp[]) =>
      describeEdit(ops, new Set(['a'.repeat(64)]))
        .map((part) => (typeof part === 'string' ? part : part.mono))
        .join('');
    expect(text(op(project({}), project({ company: copy }), [{ kind: 'create', media: logoMedia }]))).toBe('Attached the production company Zima Blue Pictures');
    expect(text(op(project({ company: copy }), project({ company: { ...copy, phone: '555' } })))).toBe('Updated the production company Zima Blue Pictures from its profile');
    expect(text(op(project({ company: copy }), project({}), [{ kind: 'trash', media: logoMedia }]))).toBe('Detached the production company Zima Blue Pictures');
  });

  it('leaves a replaced company logo out of the Trash’s list (undo brings it back with the company)', () => {
    const records = {
      p: record('p', 'project', null, {}),
      l1: record('l1', 'media', 'p', { kind: 'image', file: 'a'.repeat(64), role: COMPANY_LOGO_ROLE }, '2026-11-07T12:00:00.000Z'),
      t1: record('t1', 'media', 'p', { kind: 'image', file: 'b'.repeat(64) }, '2026-11-07T12:00:00.000Z'),
    };
    expect(trashItems(records, 'p').map((item) => item.id)).toEqual(['t1']);
    // Empty Trash still counts it, so it's offered while it's all there is, and says it goes.
    expect(oldCompanyLogos(records, 'p')).toBe(1);
    expect(emptyTrashMessage(records, 1, 0, false, 1)).toContain('1 item and 1 old company logo');
    expect(emptyTrashMessage(records, 0, 0, false, 2)).toContain('2 old company logos');
  });

  it('never takes the theme’s image as the company’s logo, even when a logo_id names it', () => {
    const records = {
      p: record('p', 'project', null, { company: { profile_id: 'co1', name: 'Zima', logo_id: 'theme-image' } }),
      'theme-image': record('theme-image', 'media', 'p', { kind: 'image', file: 'c'.repeat(64) }),
    };
    expect(detachCompany(records, 'p')).toEqual([{ kind: 'update', id: 'p', unset: ['company'] }]);
  });
});
