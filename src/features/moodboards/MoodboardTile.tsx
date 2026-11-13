import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { BoardPicker } from './BoardPicker';
import { BoardView } from './BoardView';
import { useMoodboard } from './moodboardStore';

// The Moodboard tile (5.0): the picker with no board open, else the open board. A board that's gone (deleted, a
// project switched to) shows the picker again.

export function MoodboardTile() {
  const project = useProject((s) => s.project);
  const openId = useMoodboard((s) => s.openBoardId);
  const open = useProject((s) => (openId ? s.records[openId] : undefined));
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('moodboard.noProjectOpen')}</p>;
  // Keyed by the board: another board starts with nothing kept from this one (the canvas's drawn shapes, routes and zoom).
  if (open?.type === 'board' && open.trashedAt === null && open.parentId === project.projectId) return <BoardView key={open.id} board={open} />;
  return <BoardPicker projectId={project.projectId} />;
}
