import { labels } from '../i18n';
import type { JsonValue, Props, SbdRecord } from './record';

// Attachments (3.11, docs/PHASE3_DECISIONS.md 11): PDFs and links on the project, a scene, a frame, a location or a
// person. Each is a `media` record under what it's attached to, as a frame's picture is. A PDF (a location contract, a
// release) is stored inside the .sbd, its bytes in `media_files` by SHA-256 as a picture's are, so it travels with the
// project, at most 50 MB each; Empty Trash and Clean up treat it as they treat a picture. A link stays a link.

export const ATTACHMENT_KINDS = ['pdf', 'link'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABEL: Readonly<Record<AttachmentKind, string>> = labels({
  pdf: 'attachment.kind.pdf',
  link: 'attachment.kind.link',
});

/** The largest PDF kept in a project. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** What an attachment can be on. */
export const ATTACHED_TO = ['project', 'scene', 'shot', 'location', 'person'] as const;
export type AttachedTo = (typeof ATTACHED_TO)[number];

export interface AttachmentFields {
  kind: AttachmentKind;
  /** A PDF's file name, or a link's title ('' for none). */
  name: string;
  /** A PDF's stored bytes, by SHA-256. */
  file: string;
  byteSize: number;
  /** A link's address. */
  url: string;
}

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

/** An attachment's fields; null for a media record that isn't one (a picture, a video). */
export function attachmentFields(props: Props): AttachmentFields | null {
  if (props.kind !== 'pdf' && props.kind !== 'link') return null;
  const size = props.byte_size;
  return {
    kind: props.kind,
    name: text(props.kind === 'pdf' ? props.source_name : props.title),
    file: text(props.file),
    byteSize: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : 0,
    url: text(props.url),
  };
}

export const isAttachment = (record: SbdRecord): boolean => record.type === 'media' && attachmentFields(record.props) !== null;

/** A web address a link can keep: http or https, as typed (with https:// put in front of a bare address). */
export function linkUrl(typed: string): string | null {
  const trimmed = typed.trim();
  if (trimmed === '') return null;
  // A web address as typed, or https:// in front of a bare one ("vimeo.com/1", "localhost:3000"); any other scheme,
  // written out, is refused.
  const scheme = /^https?:\/\//i.test(trimmed);
  // "https//x.com", "htps//x.com" or "https:/x.com" (a scheme mistyped) is a typo of an address, not an address:
  // refused rather than made into another ("https://https//x.com").
  const refused =
    /^[a-z][a-z0-9+.-]*:?\/\//i.test(trimmed) || /^(javascript|data|file|mailto|vbscript):/i.test(trimmed) || /^https?:(?!\/\/)/i.test(trimmed);
  const withScheme = scheme ? trimmed : refused ? null : `https://${trimmed}`;
  if (withScheme === null) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface Attachment {
  record: SbdRecord;
  fields: AttachmentFields;
  /** What it's on: the live record it's under. */
  on: SbdRecord;
}

/**
 * The project's live attachments, each with what it's on: under the project, or a live scene, frame, location or
 * person of it. One under something in the Trash is in the Trash with it, so it isn't listed.
 */
export function projectAttachments(records: Readonly<Record<string, SbdRecord>>, projectId: string): Attachment[] {
  const live = (id: string | null): SbdRecord | undefined => {
    const record = id ? records[id] : undefined;
    return record && record.trashedAt === null ? record : undefined;
  };
  const inProject = (record: SbdRecord): boolean => {
    if (record.id === projectId) return true;
    if (record.type === 'shot') {
      const scene = live(record.parentId);
      return scene?.type === 'scene' && scene.parentId === projectId;
    }
    return record.parentId === projectId;
  };
  return Object.values(records)
    .filter((r) => r.type === 'media' && r.trashedAt === null)
    .flatMap((record) => {
      const fields = attachmentFields(record.props);
      const on = live(record.parentId);
      if (!fields || !on || !(ATTACHED_TO as readonly string[]).includes(on.type) || !inProject(on)) return [];
      return [{ record, fields, on }];
    })
    .sort((a, b) => (a.record.createdAt < b.record.createdAt ? -1 : a.record.createdAt > b.record.createdAt ? 1 : 0));
}

/** "2.4 MB", "830 KB": a PDF's size as a file list writes it. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}
