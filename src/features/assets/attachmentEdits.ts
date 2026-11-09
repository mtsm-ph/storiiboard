import { showInfo, showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { isTauriApp } from '../../app/fileAccess';
import type { PictureFile } from '../../app/pictures';
import { t } from '../../core/i18n';
import { attachmentFields, MAX_PDF_BYTES, sizeLabel } from '../../core/model/attachment';
import type { SbdRecord } from '../../core/model/record';
import { readOriginal } from '../../core/media/store';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';
import type { Statement } from '../../core/storage/driver';
import { chooseExportFile } from '../../core/storage/exportFiles';

// The edits the Assets tile makes (3.11): PDFs and links added to the project or one of its items, renamed, sent to the
// Trash. Each is one op group, so one ⌘Z; a PDF's bytes are written with it, by SHA-256, as a picture's are.

type Records = Readonly<Record<string, SbdRecord>>;

const lastKey = (records: Records, parentId: string): string | null =>
  Object.values(records)
    .filter((r) => r.parentId === parentId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);

/** Whether `parentId` is something an attachment can be on, live. */
function canHold(records: Records, parentId: string): boolean {
  const parent = records[parentId];
  return parent !== undefined && parent.trashedAt === null && ['project', 'scene', 'shot', 'location', 'person'].includes(parent.type);
}

/** A PDF's bytes, kept once by content as a picture's are: no width, height or colour, which only pictures have. */
export function pdfFileStatement(sha256: string, bytes: Uint8Array, at: string): Statement {
  return {
    sql: `INSERT OR IGNORE INTO media_files (id, sha256, bytes, mime, width, height, byte_size, color_space, created_at, updated_at)
      VALUES (?, ?, ?, 'application/pdf', 0, 0, ?, '', ?, ?)`,
    params: [crypto.randomUUID(), sha256, bytes, bytes.length, at, at],
  };
}

export function newPdf(records: Records, parentId: string, name: string, sha256: string, byteSize: number, id: string = crypto.randomUUID()): Change[] {
  if (!canHold(records, parentId)) return [];
  return [
    {
      kind: 'create',
      record: { id, type: 'media', parentId, sortKey: keyBetween(lastKey(records, parentId), null), props: { kind: 'pdf', file: sha256, source_name: name, byte_size: byteSize } },
    },
  ];
}

export function newLink(records: Records, parentId: string, url: string, title: string, id: string = crypto.randomUUID()): Change[] {
  if (!canHold(records, parentId)) return [];
  return [
    {
      kind: 'create',
      record: { id, type: 'media', parentId, sortKey: keyBetween(lastKey(records, parentId), null), props: { kind: 'link', url, title: title.trim() } },
    },
  ];
}

/** A file name a PDF can be saved as: ending .pdf, without a folder or a drive in it. */
export const isPdfName = (name: string): boolean => /\.pdf$/i.test(name) && !/[/\\:]/.test(name) && name.length > 4;

/**
 * A new name: a PDF's file name (".pdf" put on when it's missing; refused with a folder or a drive in it, which Save a
 * copy couldn't use), or a link's title. Nothing when it's already that, or it can't be the name.
 */
export function renameAttachment(records: Records, id: string, name: string): Change[] {
  const record = records[id];
  const fields = record && record.trashedAt === null ? attachmentFields(record.props) : null;
  const typed = name.trim();
  const next = fields?.kind === 'pdf' && typed !== '' && !/\.pdf$/i.test(typed) ? `${typed}.pdf` : typed;
  if (!fields || next === fields.name || (fields.kind === 'pdf' && !isPdfName(next))) return [];
  return [{ kind: 'update', id, set: { [fields.kind === 'pdf' ? 'source_name' : 'title']: next } }];
}

export function trashAttachment(records: Records, id: string): Change[] {
  const record = records[id];
  return record && record.trashedAt === null && attachmentFields(record.props) ? [{ kind: 'trash', id }] : [];
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether bytes are a PDF: they start "%PDF-", whatever the file was called. */
export const isPdf = (bytes: Uint8Array): boolean => bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';

/**
 * PDFs picked or dropped, each attached to `parentId` in an edit of its own: read, checked to be a PDF of at most 50 MB
 * (one that isn't is said and skipped), stored by content. Resolves to how many were added.
 */
export async function addPdfs(files: readonly PictureFile[], parentId: string): Promise<number> {
  let added = 0;
  for (const file of files) {
    try {
      const blob = await file.read();
      if (blob.size > MAX_PDF_BYTES) {
        showInfo(t('assets.pdfTooBig', { name: file.name, size: sizeLabel(blob.size) }));
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!isPdf(bytes)) {
        showInfo(t('assets.notPdf', { name: file.name }));
        continue;
      }
      const sha = await sha256(bytes);
      const at = new Date().toISOString();
      const done = await projectStore
        .getState()
        .applyWith((now) => ({ changes: newPdf(now, parentId, file.name, sha, bytes.length), alsoWrite: [pdfFileStatement(sha, bytes, at)] }));
      if (done) added += 1;
    } catch (error) {
      showNotice(error);
    }
  }
  return added;
}

/** A copy of a stored PDF, saved where the person chooses: how it's opened outside Storiiboard. */
export async function savePdfCopy(sha256: string, name: string): Promise<void> {
  const project = projectStore.getState().project;
  if (!project) return;
  const stored = await readOriginal(project.file, sha256);
  if (!stored) {
    showInfo(t('assets.pdfMissing', { name }));
    return;
  }
  // A name from before names were checked (or a newer version's) is saved under a plain one.
  const saveAs = isPdfName(name) ? name : 'attachment.pdf';
  try {
    const target = await chooseExportFile(saveAs, isTauriApp);
    if (!target) return;
    await target.write(saveAs, stored.bytes);
    showInfo(t('assets.pdfSaved', { name: saveAs }));
  } catch (error) {
    showNotice(error);
  }
}
