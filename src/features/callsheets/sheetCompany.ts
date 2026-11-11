import { useEffect, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { companyLogo } from '../../app/company/companyEdits';
import { imageUrl } from '../../core/media/urls';
import { makeCanvas, canvasBlob } from '../../core/media/canvas';
import { fitWithin } from '../../core/media/image';
import { mediaFields, readOriginal } from '../../core/media/store';
import { projectCompany } from '../../core/model/company';
import type { SbdRecord } from '../../core/model/record';
import type { ProjectFile } from '../../core/storage/driver';

// The company on the call sheet's header (4.12): the project's own copy of it (3.2), name and logo picture, read as
// Settings → Project keeps them. Nothing is fetched or copied anew. The fingerprint (4.7) doesn't include it, so
// attaching or changing a company never makes an issued sheet read "Changed since issued".

type Records = Readonly<Record<string, SbdRecord>>;

export interface SheetCompany {
  name: string;
  /** The logo picture's file hash in the project; null when the copy has no logo (or it is not in the project). */
  logoSha256: string | null;
}

/** The project's company for the header, or null when none is attached or it has neither a name nor a logo. */
export function sheetCompany(records: Records, projectId: string): SheetCompany | null {
  const copy = projectCompany(records[projectId]?.props);
  if (!copy) return null;
  const logo = companyLogo(records, projectId, copy.logoId);
  const logoSha256 = logo ? (mediaFields(logo.props)?.sha256 ?? null) : null;
  const name = copy.name.trim();
  return name === '' && logoSha256 === null ? null : { name, logoSha256 };
}

/** The logo is drawn at most this many pixels on its long edge: a header 140 pt wide needs no more. */
const LOGO_PDF_EDGE = 600;

/**
 * The logo's bytes for the PDF, or null when the file doesn't hold them (the name prints alone). Logos are stored in
 * Display P3, which pdf-lib would embed as plain RGB and print shifted, so the picture is decoded and redrawn on an
 * sRGB canvas, small, as PNG (which keeps a transparent ground). Where that can't be done, the stored bytes go as they are.
 */
export async function companyLogoBytes(file: ProjectFile | null, company: SheetCompany | null): Promise<Uint8Array | null> {
  if (!file || !company?.logoSha256) return null;
  const read = await readOriginal(file, company.logoSha256).catch(() => null);
  if (!read) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([read.bytes as Uint8Array<ArrayBuffer>], { type: read.mime }));
    try {
      const size = fitWithin(bitmap.width, bitmap.height, LOGO_PDF_EDGE);
      const { canvas, ctx } = makeCanvas(size.width, size.height, { colorSpace: 'srgb' });
      // Asked for outright: a Mac's webview would otherwise draw in P3, the very thing being undone.
      if (!ctx) return read.bytes;
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
      const blob = await canvasBlob(canvas, 'image/png');
      return blob ? new Uint8Array(await blob.arrayBuffer()) : read.bytes;
    } finally {
      bitmap.close();
    }
  } catch {
    return read.bytes;
  }
}

/** The logo as a blob URL for the screen, null while it is read or when there is none. */
export function useCompanyLogoUrl(file: ProjectFile | null, sha256: string | null): string | null {
  // A picture written since (Update from profile, an undo) is read again; the answer is kept with the file it came from,
  // so a project switch never shows a URL that belongs to the one closed.
  const written = useProject((s) => s.picturesWritten);
  const [loaded, setLoaded] = useState<{ file: ProjectFile; sha256: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!file || !sha256) return;
    let live = true;
    void imageUrl(file, sha256).then((url) => {
      if (live) setLoaded({ file, sha256, url });
    });
    return () => {
      live = false;
    };
  }, [file, sha256, written]);
  return file && sha256 && loaded?.file === file && loaded.sha256 === sha256 ? loaded.url : null;
}
