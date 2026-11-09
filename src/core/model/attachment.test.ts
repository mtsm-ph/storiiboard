import { describe, expect, it } from 'vitest';
import { attachmentName, isPdf, isPdfName, newLink, newPdf, pdfFileStatement, renameAttachment, trashAttachment } from '../../features/assets/attachmentEdits';
import { restoreChanges, trashItems } from '../../features/trash/trash';
import { approvalBasis } from './sceneApprovals';
import { attachmentFields, linkUrl, projectAttachments, sizeLabel } from './attachment';
import { locationPhotos } from './location';
import type { Props, SbdRecord } from './record';

// Attachments (3.11): PDFs and links as media records under what they're on, listed for the project, kept apart from
// pictures; and the edits the Assets tile makes.

const at = '2026-11-09T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null, createdAt = at): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const base = () =>
  recordsOf(
    record('p', 'project', null, {}),
    record('s1', 'scene', 'p', { number: '1' }),
    record('a', 'shot', 's1', { number: '1A' }),
    record('gone', 'scene', 'p', { number: '2' }, at),
    record('g', 'shot', 'gone', { number: '2A' }),
    record('diner', 'location', 'p', { name: 'Diner' }),
    record('contract', 'media', 'diner', { kind: 'pdf', file: 'f'.repeat(64), source_name: 'Contract.pdf', byte_size: 2_500_000 }, null, '2026-11-09T10:01:00.000Z'),
    record('photo', 'media', 'diner', { kind: 'image', file: 'e'.repeat(64) }),
    record('ref', 'media', 'a', { kind: 'link', url: 'https://vimeo.com/1', title: 'Look' }, null, '2026-11-09T10:02:00.000Z'),
    record('brief', 'media', 'p', { kind: 'link', url: 'https://example.com/brief' }, null, '2026-11-09T10:00:30.000Z'),
    record('hidden', 'media', 'g', { kind: 'link', url: 'https://example.com/x' }),
    record('binned', 'media', 'p', { kind: 'pdf', file: 'd'.repeat(64), source_name: 'Old.pdf' }, at),
  );

describe('attachments', () => {
  it('read as a PDF or a link; a picture is neither', () => {
    expect(attachmentFields({ kind: 'link', url: 'https://x.com', title: 'X' })).toEqual({ kind: 'link', name: 'X', file: '', byteSize: 0, url: 'https://x.com' });
    expect(attachmentFields({ kind: 'image', file: 'a' })).toBeNull();
  });

  it('are listed with what they’re on, oldest first; none under something in the Trash, and none in the Trash', () => {
    expect(projectAttachments(base(), 'p').map((a) => [a.record.id, a.on.id])).toEqual([
      ['brief', 'p'],
      ['contract', 'diner'],
      ['ref', 'a'],
    ]);
  });

  it('stay out of a location’s photos', () => {
    expect(locationPhotos(base(), 'diner').map((r) => r.id)).toEqual(['photo']);
  });

  it('keep only web links, adding https:// to a bare address', () => {
    expect(linkUrl('vimeo.com/1')).toBe('https://vimeo.com/1');
    expect(linkUrl('http://x.com/a b')).toBe('http://x.com/a%20b');
    expect(linkUrl('javascript:alert(1)')).toBeNull();
    expect(linkUrl('file:///C:/x.pdf')).toBeNull();
    expect(linkUrl('  ')).toBeNull();
    // A host with a port is an address, not a scheme.
    expect(linkUrl('localhost:3000/a')).toBe('https://localhost:3000/a');
    expect(linkUrl('ftp://x.com/a')).toBeNull();
    expect(linkUrl('https//x.com')).toBeNull();
    expect(linkUrl('htps//x.com')).toBeNull();
    expect(linkUrl('https:/x.com')).toBeNull();
    // As Open refuses them: a name and password, or a link past 2048 characters.
    expect(linkUrl('https://u:p@x.com/')).toBeNull();
    expect(linkUrl(`https://x.com/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('say a PDF’s size as a file list does', () => {
    expect(sizeLabel(2_500_000)).toBe('2.4 MB');
    expect(sizeLabel(830_000)).toBe('811 KB');
    expect(sizeLabel(10)).toBe('1 KB');
  });
});

describe('the Assets tile’s edits', () => {
  it('attach a PDF or a link only to the project or a live scene, frame, location or person', () => {
    const records = base();
    expect(newPdf(records, 'diner', 'Release.pdf', 'c'.repeat(64), 1234, 'n')).toEqual([
      { kind: 'create', record: { id: 'n', type: 'media', parentId: 'diner', sortKey: expect.any(String) as string, props: { kind: 'pdf', file: 'c'.repeat(64), source_name: 'Release.pdf', byte_size: 1234 } } },
    ]);
    expect(newLink(records, 'a', 'https://x.com', '  Look  ', 'l')[0]).toMatchObject({ record: { props: { kind: 'link', url: 'https://x.com', title: 'Look' } } });
    expect(newLink(records, 'gone', 'https://x.com', '', 'l')).toEqual([]);
    expect(newLink(records, 'contract', 'https://x.com', '', 'l')).toEqual([]);
  });

  it('rename one (never a PDF to nothing), and send one to the Trash, never a picture', () => {
    const records = base();
    expect(renameAttachment(records, 'contract', 'Lease.pdf')).toEqual([{ kind: 'update', id: 'contract', set: { source_name: 'Lease.pdf' } }]);
    expect(renameAttachment(records, 'contract', '  ')).toEqual([]);
    // A PDF keeps a name Save a copy can use: .pdf put on, a folder or a drive refused.
    expect(renameAttachment(records, 'contract', 'Lease')).toEqual([{ kind: 'update', id: 'contract', set: { source_name: 'Lease.pdf' } }]);
    expect(renameAttachment(records, 'contract', 'a/b.pdf')).toEqual([]);
    expect(renameAttachment(records, 'contract', 'C:x.pdf')).toEqual([]);
    expect(renameAttachment(records, 'contract', '.hidden')).toEqual([]);
    expect(renameAttachment(records, 'contract', 'CON')).toEqual([]);
    expect(isPdfName('..pdf')).toBe(false);
    expect(isPdfName('Contract.PDF')).toBe(true);
    expect(isPdfName('COM0.pdf')).toBe(false);
    expect(isPdfName('NULL.pdf')).toBe(true);
    expect(isPdfName('a\u0000b.pdf')).toBe(false);
    expect(isPdfName('Budget?.pdf')).toBe(false);
    // The tile's check: a refused name is null; one that comes to the same name is that name.
    const pdf = attachmentFields({ kind: 'pdf', source_name: 'Contract.pdf' });
    expect(pdf && attachmentName(pdf, 'Contract')).toBe('Contract.pdf');
    expect(pdf && attachmentName(pdf, 'Contract.pdf  ')).toBe('Contract.pdf');
    expect(pdf && attachmentName(pdf, 'CON')).toBeNull();
    expect(renameAttachment(records, 'ref', '')).toEqual([{ kind: 'update', id: 'ref', set: { title: '' } }]);
    expect(trashAttachment(records, 'ref')).toEqual([{ kind: 'trash', id: 'ref' }]);
    expect(trashAttachment(records, 'photo')).toEqual([]);
  });

  it('know a PDF by its first bytes, and store it by content with no picture’s size', () => {
    expect(isPdf(new TextEncoder().encode('%PDF-1.7 …'))).toBe(true);
    expect(isPdf(new TextEncoder().encode('Hello'))).toBe(false);
    const statement = pdfFileStatement('c'.repeat(64), new Uint8Array([1, 2]), at);
    expect(statement.sql).toContain("'application/pdf', 0, 0");
    expect(statement.params).toEqual([expect.any(String), 'c'.repeat(64), new Uint8Array([1, 2]), 2, at, at]);
  });
});

describe('attachments on a frame, beside its picture', () => {
  const withPicture = () => {
    const records = base();
    return {
      ...records,
      a: { ...(records.a as SbdRecord), props: { number: '1A', media_id: 'pic' } },
      pic: record('pic', 'media', 'a', { kind: 'image', file: 'b'.repeat(64), width: 1920, height: 1080 }),
      gonePdf: record('gonePdf', 'media', 'a', { kind: 'pdf', file: 'c'.repeat(64), source_name: 'Release.pdf' }, at),
    };
  };

  it('come back from the Trash as themselves, never as the frame’s picture', () => {
    expect(restoreChanges(withPicture(), 'p', 'gonePdf')).toEqual([{ kind: 'restore', id: 'gonePdf' }]);
  });

  it('read in the Trash with their kind apart from their name', () => {
    expect(trashItems(withPicture(), 'p').find((i) => i.id === 'gonePdf')?.name).toBe('Release.pdf (PDF)');
  });

  it('leave the scene’s approvals as they were: attaching a release changes nothing a department did', () => {
    const records = withPicture();
    const before = approvalBasis(records, 's1', 'camera');
    const attached = { ...records, extra: record('extra', 'media', 'a', { kind: 'link', url: 'https://x.com' }) };
    expect(approvalBasis(attached, 's1', 'camera')).toBe(before);
  });
});

