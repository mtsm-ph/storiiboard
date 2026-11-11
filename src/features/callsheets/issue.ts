import { callSheetIssues, dayCallsheet, nextIssueVersion } from '../../core/model/callsheet';
import { MAX_PDF_BYTES } from '../../core/model/attachment';
import type { SbdRecord } from '../../core/model/record';
import { isDayDate } from '../../core/model/shootDay';
import { dayScenes } from '../../core/model/schedule';
import { sceneFields } from '../../core/model/storyboard';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';
import type { SlateNumbers } from '../../core/model/shotNumbers';
import { lockNotice, relettered, setNumbersLocked } from '../storyboard/board';
import { FINGERPRINT_VERSION } from './fingerprint';

// Issuing a call sheet (4.7): one change list, so one op group and one ⌘Z. It keeps the PDF as sent (a `media` record of
// kind `pdf` under the day's `callsheet` record, its bytes stored by SHA-256 as 3.11's PDFs are, written with the group),
// makes the `callsheet` record when the day has none yet, and locks the shot numbers of the day's scenes that aren't
// locked, so slates and the script supervisor work from them. Pure: the PDF is made, hashed and fingerprinted by the
// caller (issueCallSheet.ts); nothing here touches the world.

type Records = Readonly<Record<string, SbdRecord>>;

export interface IssueInput {
  projectId: string;
  dayId: string;
  /** The version the PDF was made with: it is checked against the records, since the header printed it. */
  version: number;
  /** Who issued it, as ops record the author. */
  author: string;
  issuedAt: Date;
  /** The zone the header's time was written in, kept so the list of versions shows it as the PDF did. */
  zone: string;
  /** The PDF's SHA-256 and size. */
  sha256: string;
  byteSize: number;
  /** The PDF's file name, version included (issuedFileName). */
  name: string;
  fingerprint: string;
  /** Ids for the records made, so a test can name them. */
  ids?: { callsheet?: string; media?: string };
}

export type IssueRefusal = 'noDay' | 'noDate' | 'tooBig' | 'versionTaken';

/** The file name of an issued version: the sheet's own for version 1, " v2" before ".pdf" from version 2. */
export const issuedFileName = (name: string, version: number): string => (version < 2 ? name : name.replace(/\.pdf$/i, '') + ` v${String(version)}.pdf`);

/** The changes that issue a day's sheet, or why it can't be. */
export function issueChanges(records: Records, slate: SlateNumbers, input: IssueInput): { changes: Change[]; notices: string[] } | { refused: IssueRefusal } {
  const day = records[input.dayId];
  if (day?.type !== 'shoot_day' || day.trashedAt !== null) return { refused: 'noDay' };
  if (!isDayDate(typeof day.props.date === 'string' ? day.props.date : '')) return { refused: 'noDate' };
  if (input.byteSize > MAX_PDF_BYTES) return { refused: 'tooBig' };
  // The highest live issue's plus one: after an undo the number is used again. A different one means another issue
  // landed since the header was printed.
  if (nextIssueVersion(records, input.dayId) !== input.version) return { refused: 'versionTaken' };

  const changes: Change[] = [];
  let sheet = dayCallsheet(records, input.dayId)?.id ?? null;
  if (sheet === null) {
    sheet = input.ids?.callsheet ?? crypto.randomUUID();
    // After every call sheet the day has had (in the Trash too), so a restored one never shares a key.
    const last = Object.values(records)
      .filter((r) => r.type === 'callsheet' && r.parentId === input.dayId)
      .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
    changes.push({ kind: 'create', record: { id: sheet, type: 'callsheet', parentId: input.dayId, sortKey: keyBetween(last, null), props: {} } });
  }
  const lastIssue = Object.values(records)
    .filter((r) => r.parentId === sheet)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  changes.push({
    kind: 'create',
    record: {
      id: input.ids?.media ?? crypto.randomUUID(),
      type: 'media',
      parentId: sheet,
      sortKey: keyBetween(lastIssue, null),
      props: {
        kind: 'pdf',
        file: input.sha256,
        source_name: input.name,
        byte_size: input.byteSize,
        issue_version: input.version,
        issued_at: input.issuedAt.toISOString(),
        issued_by: input.author,
        issued_zone: input.zone,
        fingerprint: input.fingerprint,
        fingerprint_version: FINGERPRINT_VERSION,
      },
    },
  });
  // Only the scenes not locked yet: the ones already locked are left alone, so undoing the issue unlocks only what it locked.
  // A lock can re-letter frames to keep slate numbers unique (1.26): said, as the Scenes tile says it.
  // One scene at a time, each reading the records as the one before left them, so two scenes never both take the same
  // letter (4AA).
  const notices: string[] = [];
  let around = records;
  for (const scene of dayScenes(records, input.projectId, input.dayId)) {
    const now = around[scene.id] ?? scene;
    const fields = sceneFields(now.props);
    if (fields.numbersLocked) continue;
    const locking = setNumbersLocked(around, input.projectId, scene.id, true, slate);
    const notice = lockNotice(fields.number, relettered(around, input.projectId, locking, slate));
    if (notice !== null) notices.push(notice);
    changes.push(...locking);
    around = withUpdates(around, locking);
  }
  return { changes, notices };
}

/** The records with `update` changes applied in memory (a lock only updates), for the next scene's lock to read. */
function withUpdates(records: Records, changes: readonly Change[]): Records {
  const next: Record<string, SbdRecord> = { ...records };
  for (const change of changes) {
    const was = change.kind === 'update' ? next[change.id] : undefined;
    if (change.kind === 'update' && was) next[change.id] = { ...was, props: { ...was.props, ...change.set } };
  }
  return next;
}

/** The newest live issue of a day, or undefined before the first. */
export const latestIssue = (records: Records, dayId: string) => callSheetIssues(records, dayId)[0];
