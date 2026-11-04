import { prepareImage } from '../../core/media/image';
import { imageStatements, mediaFields, mediaProps, type ImageSource, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Statement } from '../../core/storage/driver';
import { extractAccents } from '../../ui/theme/generator/extract';
import { DEFAULT_ACCENT, themeFor } from '../../ui/theme/generator/generate';
import { readProjectTheme, themeProp } from '../../ui/theme/projectTheme';
import type { ResolvedTheme } from '../../ui/theme/theme';
import type { PictureFile } from '../pictures';
import type { ThemeChoice } from './ThemeChooser';

// The edits behind onboarding and Settings → Theme (1.16). A logo or key image is a `media` record under the project,
// stored as frame pictures are (capped, colour kept), and the theme's `image_id` names it; the theme is the project
// record's `theme` prop, with its tokens worked out now and stored. Image and theme land in one op group, so one undo
// takes back both. As with a frame's picture, a replaced image goes to the Trash in the same group.

type Records = Readonly<Record<string, SbdRecord>>;

/** An image picked for the theme, ready to store, with the accents it offers. */
export interface ThemeImage {
  image: PreparedImage;
  source: ImageSource;
  candidates: string[];
  /** A blob: URL to show it in the well until it's stored. */
  previewUrl: string;
}

/** Reads a picked, dropped or pasted file: stored as a picture would be, its accents read from the original. */
export async function prepareThemeImage(file: PictureFile): Promise<ThemeImage> {
  const blob = await file.read();
  const named = new File([blob], file.name, { type: blob.type });
  const [image, candidates] = await Promise.all([prepareImage(named), extractAccents(named)]);
  const previewUrl = URL.createObjectURL(new Blob([image.thumbnail.bytes as Uint8Array<ArrayBuffer>], { type: image.thumbnail.mime }));
  return { image, source: { name: file.name, ...(file.path ? { path: file.path } : {}) }, candidates, previewUrl };
}

/** The project's current theme, as Settings → Theme shows it. */
export interface CurrentTheme {
  choice: ThemeChoice;
  candidates: string[];
  /** The logo or key image's media record, when there is one. */
  imageId: string | null;
  sha256: string | null;
  /** Whether the project stores a theme at all, so there's something to regenerate. */
  stored: boolean;
}

const isHexList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));

/** The kit's own orange stands for no accent of the project's own, so it keeps the kit's exact look. */
const ownAccent = (accent: string | null) => (accent && accent.toUpperCase() !== DEFAULT_ACCENT ? accent.toUpperCase() : null);

/**
 * The media record a theme names, only if it really is the project's logo or key image: a live `media` record under
 * the project. A hand-edited `image_id` naming a frame's picture, a shot or the project itself is never shown or
 * trashed as the theme's image.
 */
function themeImage(records: Records, projectId: string, imageId: unknown): SbdRecord | null {
  const media = typeof imageId === 'string' ? records[imageId] : undefined;
  return media && media.type === 'media' && media.parentId === projectId && media.trashedAt === null ? media : null;
}

export function currentTheme(records: Records, projectId: string, osDark: boolean): CurrentTheme {
  const prop = records[projectId]?.props.theme;
  const stored = typeof prop === 'object' && prop !== null && !Array.isArray(prop) ? prop : null;
  const read = readProjectTheme(prop);
  // The accent picked is the one to rebuild from, even when the stored tokens can't be read (what Regenerate is for);
  // a theme on the kit's colours (`default`) has none of its own.
  const picked = stored && stored.source !== 'default' && typeof stored.accent_picked === 'string' ? ownAccent(stored.accent_picked) : null;
  const media = themeImage(records, projectId, stored?.image_id);
  return {
    choice: { accent: picked, mode: read?.mode ?? (osDark ? 'dark' : 'light') },
    candidates: stored && isHexList(stored.candidates) ? stored.candidates : [],
    imageId: media?.id ?? null,
    sha256: media ? (mediaFields(media.props)?.sha256 ?? null) : null,
    stored: stored !== null,
  };
}

/** What a change to the look sets; anything left out stays as the project has it when the edit lands. */
export interface ThemePatch {
  accent?: string | null;
  mode?: ResolvedTheme;
  /** A new logo or key image; its most saturated accent is the default unless an accent is given too. */
  image?: ThemeImage;
}

/**
 * The op group that sets a project's look, worked out from the records as they are when it lands (so two quick
 * changes never undo each other): a new image (when one was picked) as a media record under the project, the old one
 * to the Trash, and the theme with its tokens. With no accent and no image it stores the kit's look in the mode picked.
 */
export function setTheme(
  records: Records,
  projectId: string,
  patch: ThemePatch,
  options: { projectPath: string; osDark: boolean; now?: Date },
): { changes: Change[]; alsoWrite: Statement[] } {
  const current = currentTheme(records, projectId, options.osDark);
  const changes: Change[] = [];
  const alsoWrite: Statement[] = [];
  let imageId = current.imageId;
  let candidates = current.candidates;
  if (patch.image) {
    const siblings = Object.values(records).filter((r) => r.type === 'media' && r.parentId === projectId);
    const last = siblings.reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
    imageId = crypto.randomUUID();
    candidates = patch.image.candidates;
    changes.push({
      kind: 'create',
      record: { id: imageId, type: 'media', parentId: projectId, sortKey: keyBetween(last, null), props: mediaProps(patch.image.image, patch.image.source, options.projectPath) },
    });
    alsoWrite.push(...imageStatements(patch.image.image, options.now ?? new Date()));
    if (current.imageId) changes.push({ kind: 'trash', id: current.imageId });
  }
  const accent = ownAccent(patch.accent !== undefined ? patch.accent : patch.image ? (patch.image.candidates[0] ?? null) : current.choice.accent);
  const mode = patch.mode ?? current.choice.mode;
  // The kit's orange with no image is the default look, kept for the mode the person picked.
  const source = !accent && !imageId ? 'default' : accent && !candidates.some((c) => c.toUpperCase() === accent) ? 'manual' : 'image';
  changes.push({
    kind: 'update',
    id: projectId,
    set: { theme: themeProp(themeFor(accent), { source, mode, imageId, candidates }) },
  });
  return { changes, alsoWrite };
}

/** Reset to default: the kit's look again, and the image to the Trash; one undo brings both back. */
export function resetTheme(records: Records, projectId: string): Change[] {
  const theme = records[projectId]?.props.theme;
  if (theme === undefined) return [];
  const image = themeImage(records, projectId, typeof theme === 'object' && theme !== null && !Array.isArray(theme) ? theme.image_id : null);
  return [{ kind: 'update', id: projectId, unset: ['theme'] }, ...(image ? [{ kind: 'trash' as const, id: image.id }] : [])];
}
