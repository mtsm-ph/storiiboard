import { projectStore, type ProjectState } from '../../app/projectStore';
import type { StoreApi } from 'zustand/vanilla';
import { editAuthor, profileStore } from '../../app/settings/profileStore';
import { showInfo, showNotice } from '../../app/notice';
import { t } from '../../core/i18n';
import { MAX_PDF_BYTES, sizeLabel } from '../../core/model/attachment';
import { nextIssueVersion } from '../../core/model/callsheet';
import { computerTimeZone } from '../../core/model/location';
import { replacedWarning } from '../export/pdfStoryboardFormat';
import { callSheetFileName } from './callSheetName';
import { makeCallSheetPdf, sheetNow, stillFindingZone, type ExportCallSheetOptions } from './exportCallSheet';
import { callSheetFingerprint } from './fingerprint';
import { gatherSheetMaps } from './gatherSheetMaps';
import { issueChanges, issuedFileName, type IssueInput, type IssueRefusal } from './issue';
import { pdfFileStatement, sha256 } from '../assets/attachmentEdits';

// Issue on the Call sheet tile (4.7): the part that touches the world. It makes the PDF (4.6's code, with the version and
// time in its header), hashes it, and writes the whole issue as one edit; issue.ts decides what that edit is. It sends
// nothing to anyone (publishing is Phase 9). It asks for no forecast: that is whatever the tile already holds. The map images'
// tiles come through the tile cache (4.10) and are not part of the fingerprint.

export interface IssueWrite extends IssueInput {
  /** The PDF itself, stored by its SHA-256 in the same edit. */
  bytes: Uint8Array;
}

/** How a write ended: issued (with what the lock has to say), refused by the rules, or not written. */
export type IssueOutcome =
  | { kind: 'issued'; notices: string[] }
  | { kind: 'refused'; reason: IssueRefusal }
  /** The edit was built and not written: the store has already said why (a write error, a file a sync replaced). */
  | { kind: 'failed' }
  /** A project switch replaced the project before this edit's turn: it never landed in the other one. */
  | { kind: 'dropped' };

/** Writes one issue as one edit, from the records as they are at its turn in the queue. */
export async function writeIssue(store: StoreApi<ProjectState>, write: IssueWrite): Promise<IssueOutcome> {
  // A holder, since the builder sets it inside a callback.
  const outcome: { refused: IssueRefusal | null; notices: string[]; built: boolean } = { refused: null, notices: [], built: false };
  const done = await store.getState().applyWith((records, slate) => {
    // The builder only runs when the edit gets its turn in the right project: if it never did, a switch dropped it.
    outcome.built = true;
    const result = issueChanges(records, slate, write);
    if ('refused' in result) {
      outcome.refused = result.refused;
      return { changes: [] };
    }
    outcome.notices = result.notices;
    return { changes: result.changes, alsoWrite: [pdfFileStatement(write.sha256, write.bytes, write.issuedAt.toISOString())] };
  });
  // Checked first: an edit with nothing to write resolves as done.
  if (outcome.refused !== null) return { kind: 'refused', reason: outcome.refused };
  if (done) return { kind: 'issued', notices: outcome.notices };
  return outcome.built ? { kind: 'failed' } : { kind: 'dropped' };
}

/** Resolves to whether the sheet was issued; a refusal has said why. */
export async function issueCallSheetPdf(options: ExportCallSheetOptions): Promise<boolean> {
  try {
    // The maps first: they depend only on the places, and the tiles can take seconds. Then the records are read after the
    // queued edits land, and the sheet, PDF and fingerprint follow at once, so the time between the PDF's sheet and the
    // lock being written stays milliseconds. A place that changed meanwhile has its map gathered again, and only that one.
    // What would be refused anyway (no date, a zone still on its way) is said before any wait for tiles.
    // A call or date typed just before pressing Issue is saved on the blur, in the queue: wait for it first.
    await projectStore.getState().applyWith(() => ({ changes: [] }));
    const first = sheetNow(options);
    if (first?.day.fields.date === '') {
      showNotice(new Error(t('callSheet.issue.noDate')));
      return false;
    }
    if (first && stillFindingZone(first)) {
      showNotice(new Error(t('callSheet.pdf.zonePending')));
      return false;
    }
    const maps = first ? await gatherSheetMaps(first) : undefined;
    // Edits made during the tiles' wait land too, then the project is read.
    await projectStore.getState().applyWith(() => ({ changes: [] }));
    const sheet = sheetNow(options);
    if (!sheet) return false;
    if (stillFindingZone(sheet)) {
      showNotice(new Error(t('callSheet.pdf.zonePending')));
      return false;
    }
    if (sheet.day.fields.date === '') {
      showNotice(new Error(t('callSheet.issue.noDate')));
      return false;
    }
    const version = nextIssueVersion(projectStore.getState().records, options.dayId);
    const issuedAt = new Date();
    const fingerprint = await callSheetFingerprint(sheet, options.app, options.projectName);
    const pdf = await makeCallSheetPdf(sheet, options, { version, issuedAt }, maps);
    if (pdf.bytes.length > MAX_PDF_BYTES) {
      showNotice(new Error(t('callSheet.issue.tooBig', { size: sizeLabel(pdf.bytes.length), max: sizeLabel(MAX_PDF_BYTES) })));
      return false;
    }
    const bytes = new Uint8Array(pdf.bytes);
    const result = await writeIssue(projectStore, {
      projectId: options.projectId,
      dayId: options.dayId,
      version,
      author: editAuthor(profileStore.getState()),
      issuedAt,
      zone: sheet.timesIn?.zone ?? computerTimeZone(),
      sha256: await sha256(bytes),
      bytes,
      byteSize: bytes.length,
      name: issuedFileName(callSheetFileName(sheet.title || options.projectName, sheet.day.number, sheet.day.fields.date), version),
      fingerprint,
    });
    switch (result.kind) {
      case 'issued': {
        // About a step just made, so an undo takes it away (1.28).
        let said = t('callSheet.issue.done', { version });
        if (result.notices.length > 0) said = t('callSheet.issue.doneWith', { said, more: result.notices.join(' ') });
        // As Export shows it: a warning when some characters printed as ?.
        if (pdf.replaced) showNotice(new Error(t('export.doneWarning', { said, warning: replacedWarning() })));
        else showInfo(said, { step: true });
        return true;
      }
      case 'refused':
        if (result.reason === 'noDate') showNotice(new Error(t('callSheet.issue.noDate')));
        else if (result.reason === 'tooBig') showNotice(new Error(t('callSheet.issue.tooBig', { size: sizeLabel(bytes.length), max: sizeLabel(MAX_PDF_BYTES) })));
        else showNotice(new Error(t('callSheet.issue.changed')));
        return false;
      case 'dropped':
        showNotice(new Error(t('callSheet.issue.dropped')));
        return false;
      case 'failed':
        return false;
    }
  } catch (error) {
    showNotice(error);
    return false;
  }
}
