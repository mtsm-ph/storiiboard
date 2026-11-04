import { prepareImage } from '../../core/media/image';
import { imageStatements, mediaFields, mediaProps, type ImageSource, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import type { Statement } from '../../core/storage/driver';
import { extractAccents } from '../../ui/theme/generator/extract';
import { themeFor } from '../../ui/theme/generator/generate';
import { readProjectTheme, themeProp } from '../../ui/theme/projectTheme';
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
}

const isHexList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v));

export function currentTheme(records: Records, projectId: string, osDark: boolean): CurrentTheme {
  const prop = records[projectId]?.props.theme;
  const stored = typeof prop === 'object' && prop !== null && !Array.isArray(prop) ? prop : null;
  const read = readProjectTheme(prop);
  const picked = stored && typeof stored.accent_picked === 'string' ? stored.accent_picked : null;
  const imageId = stored && typeof stored.image_id === 'string' ? stored.image_id : null;
  const media = imageId ? records[imageId] : undefined;
  return {
    // A theme on the kit's colours (`default`) has no accent of its own, whatever it stored as picked.
    choice: { accent: read?.tokens ? picked : null, mode: read?.mode ?? (osDark ? 'dark' : 'light') },
    candidates: stored && isHexList(stored.candidates) ? stored.candidates : [],
    imageId: media && media.trashedAt === null ? imageId : null,
    sha256: media && media.trashedAt === null ? (mediaFields(media.props)?.sha256 ?? null) : null,
  };
}

/**
 * The op group that sets a project's look: a new image (when one was picked) as a media record under the project,
 * and the theme with its tokens. With no accent and no image it stores the kit's look in the mode picked.
 */
export function setTheme(
  records: Records,
  projectId: string,
  choice: ThemeChoice,
  options: { image?: ThemeImage | null; keepImageId?: string | null; candidates: readonly string[]; projectPath: string; now?: Date },
): { changes: Change[]; alsoWrite: Statement[] } {
  const changes: Change[] = [];
  let imageId = options.keepImageId ?? null;
  const alsoWrite: Statement[] = [];
  if (options.image) {
    const siblings = Object.values(records).filter((r) => r.type === 'media' && r.parentId === projectId);
    const last = siblings.reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
    imageId = crypto.randomUUID();
    changes.push({
      kind: 'create',
      record: {
        id: imageId,
        type: 'media',
        parentId: projectId,
        sortKey: keyBetween(last, null),
        props: mediaProps(options.image.image, options.image.source, options.projectPath),
      },
    });
    alsoWrite.push(...imageStatements(options.image.image, options.now ?? new Date()));
    const replaced = options.keepImageId ? records[options.keepImageId] : undefined;
    if (replaced && replaced.trashedAt === null) changes.push({ kind: 'trash', id: replaced.id });
  }
  const theme = themeFor(choice.accent);
  // The kit's orange with no image is the default look, kept for the mode the person picked.
  const source =
    !choice.accent && !imageId
      ? 'default'
      : choice.accent && !options.candidates.some((c) => c.toUpperCase() === choice.accent?.toUpperCase())
        ? 'manual'
        : 'image';
  changes.push({
    kind: 'update',
    id: projectId,
    set: { theme: themeProp(theme, { source, mode: choice.mode, imageId, candidates: options.candidates }) },
  });
  return { changes, alsoWrite };
}

/** Reset to default: the kit's look again, and the image to the Trash; one undo brings both back. */
export function resetTheme(records: Records, projectId: string): Change[] {
  const theme = records[projectId]?.props.theme;
  const imageId = typeof theme === 'object' && theme !== null && !Array.isArray(theme) && typeof theme.image_id === 'string' ? theme.image_id : null;
  const image = imageId ? records[imageId] : undefined;
  return [
    { kind: 'update', id: projectId, unset: ['theme'] },
    ...(image && image.trashedAt === null ? [{ kind: 'trash' as const, id: image.id }] : []),
  ];
}
