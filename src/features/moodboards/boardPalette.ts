import { showInfo } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { mediaFields } from '../../core/media/store';
import { DEFAULT_CROP } from '../../core/media/crop';
import type { SbdRecord } from '../../core/model/record';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { Lab } from '../../ui/theme/generator/color';
import { generateFrom, isGenerating } from '../storyboard/palette/actions';
import { readFrame } from '../storyboard/palette/read';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { boardFields, boardTitle, linkedRecords } from './boards';
import { mediaChildOf, posterOf } from './itemMedia';
import { itemFields, itemsOf } from './items';

// A scene's palette from a moodboard (5.6b, decision 9): the board's pictures read as frames are (the storyboard's palette code,
// on the device), each weighing the same. A picture on the board, a video card's poster and a shot card's frame count, one each;
// the stored pictures are read (2560 px), never originals.

type Records = Readonly<Record<string, SbdRecord>>;

export interface BoardPicture {
  sha256: string;
  crop: ReturnType<typeof shotFields>['crop'];
  /** The shape it's read in: a shot card's frame's (the project's), else null for the picture's own. */
  aspect: 'frame' | null;
}

/** The pictures on a board that a palette is read from, in back-to-front order; trashed items and records are left out. */
export function boardPictures(records: Records, boardId: string): BoardPicture[] {
  return itemsOf(records, boardId).flatMap((item): BoardPicture[] => {
    const fields = itemFields(item.props);
    if (!fields) return [];
    if (fields.kind === 'picture') {
      const media = mediaChildOf(records, item.id, 'image');
      const picture = media ? mediaFields(media.props) : null;
      return picture ? [{ sha256: picture.sha256, crop: DEFAULT_CROP, aspect: null }] : [];
    }
    if (fields.kind === 'video') {
      const video = mediaChildOf(records, item.id, 'video');
      const poster = video ? posterOf(records, video) : undefined;
      const picture = poster ? mediaFields(poster.props) : null;
      return picture ? [{ sha256: picture.sha256, crop: DEFAULT_CROP, aspect: null }] : [];
    }
    if (fields.kind === 'shot_card') {
      const shot = records[fields.shotId];
      if (shot?.type !== 'shot' || shot.trashedAt !== null) return [];
      const shotProps = shotFields(shot.props);
      const media = shotProps.mediaId ? records[shotProps.mediaId] : undefined;
      const picture = media && media.trashedAt === null ? mediaFields(media.props) : null;
      return picture ? [{ sha256: picture.sha256, crop: shotProps.crop, aspect: 'frame' }] : [];
    }
    return [];
  });
}

/** The live scenes a board is linked to, in the order the board lists them. */
export function boardScenes(records: Records, board: SbdRecord): SbdRecord[] {
  return linkedRecords(records, board).scenes;
}

/** A deck (5.5) is pages, not a mood: only a moodboard makes a palette. */
export const canMakePalette = (board: SbdRecord): boolean => board.type === 'board' && board.trashedAt === null && boardFields(board.props).kind === 'moodboard';

/**
 * The boards a scene's palette can be made from, named for a menu: two with one title are told apart by what they are, a
 * department's board or a free one.
 */
export function boardChoices(boards: readonly SbdRecord[]): { id: string; name: string }[] {
  const usable = boards.filter(canMakePalette);
  const titles = usable.map(boardTitle);
  return usable.map((board, i) => {
    const title = titles[i] ?? '';
    if (titles.filter((other) => other === title).length < 2) return { id: board.id, name: title };
    return { id: board.id, name: t(boardFields(board.props).department !== null ? 'palette.board.kindDepartment' : 'palette.board.kindFree', { name: title }) };
  });
}

/**
 * Sets a scene's palette from a board's pictures, in one op group (undo takes it back), keeping the palette's size and locked
 * colours as Generate does. A board with no pictures says so and changes nothing. Resolves to whether a palette was written.
 */
export async function makePaletteFromBoard(boardId: string, sceneId: string): Promise<boolean> {
  const { records } = projectStore.getState();
  const board = records[boardId];
  const scene = records[sceneId];
  if (!board || !canMakePalette(board) || scene?.type !== 'scene' || isGenerating(sceneId)) return false;
  const name = boardTitle(board);
  if (boardPictures(records, boardId).length === 0) {
    showInfo(t('palette.board.noPictures', { board: name }));
    return false;
  }
  const written = await generateFrom(
    sceneId,
    async (project, now, frameAspect) => {
      const pictures = boardPictures(now, boardId);
      // A shot card's frame is read in the project's frame shape, as the storyboard reads it; a picture whole.
      const read = await Promise.all(pictures.map((p) => readFrame(project.file, p.sha256, p.crop, p.aspect === 'frame' ? frameAspect : null).catch(() => null)));
      return read.filter((pixels): pixels is Lab[] => pixels !== null);
    },
    { none: t('palette.board.unreadable', { board: name }), nothingNew: t('palette.board.nothingNew', { board: name }) },
    { preferNew: false },
  );
  // A step notice: ⌘Z takes the palette back, and the words about it go too.
  if (written) {
    const fields = boardFields(board.props);
    const scene = sceneLabel(sceneFields(records[sceneId]?.props ?? {}).number);
    showInfo(fields.department !== null && fields.name === null ? t('palette.board.madeDepartment', { scene, board: DEPARTMENT_LABELS[fields.department] }) : t('palette.board.made', { scene, board: name }), { step: true });
  }
  return written;
}
