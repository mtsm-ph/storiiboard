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
const { attachCompany, detachCompany } = await import('./companyEdits');

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
    const id = addCompany();
    if (!id) throw new Error('added');
    const [blank] = companiesStore.getState().companies;
    if (!blank) throw new Error('the profile');
    expect(saveCompany({ ...blank, name: '  Zima Blue Pictures  ', phone: '+1 212 555 0100' })).toBe(true);
    expect(companiesStore.getState().companies[0]).toMatchObject({ name: 'Zima Blue Pictures', phone: '+1 212 555 0100' });
    storage.full = true;
    expect(saveCompany({ ...blank, name: 'Lost' })).toBe(false);
    expect(companiesStore.getState().companies[0]?.name).toBe('Zima Blue Pictures');
    storage.full = false;
    expect(removeCompany(id)).toBe(true);
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

    const now = { ...base(), p: record('p', 'project', null, { title: 'Bey County', ...props }), [logoId]: record(logoId, 'media', 'p', {}) };
    const again = attachCompany(now, 'p', { ...profile, name: 'Zima Blue' }, null, '/Films/Bey County.sbd');
    expect(again.changes).toContainEqual({ kind: 'trash', id: logoId });
    const next = again.changes.find((c) => c.kind === 'update');
    expect(projectCompany(next?.kind === 'update' ? next.set : {})).toMatchObject({ name: 'Zima Blue', logoId: null });

    // Detached: the copy off, its logo to the Trash.
    expect(detachCompany(now, 'p')).toEqual([
      { kind: 'trash', id: logoId },
      { kind: 'update', id: 'p', unset: ['company'] },
    ]);
    expect(detachCompany(base(), 'p')).toEqual([]);
  });
});
