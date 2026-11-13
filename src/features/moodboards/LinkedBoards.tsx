import { useProject } from '../../app/projectStore';
import { showWorkspace } from '../../app/shell/workspaceStore';
import { t } from '../../core/i18n';
import { boardsLinkedTo, boardTitle, type LinkKind } from './boards';
import { moodboardStore } from './moodboardStore';

// The boards linked to a scene, character or location (5.4), read the other way from the board's own "Linked to" line: in the
// storyboard Inspector's scene section, the Locations tile and the character in Team and Cast and crew. Each opens its board in
// the Moodboard. Nothing shows when no live board links to it (a trashed board isn't listed).

/** `name` is what the boards are linked to (a character's name), so a screen reader hears which list this is. */
export function LinkedBoards({ kind, id, label = true, name }: { kind: LinkKind; id: string; label?: boolean; name?: string }) {
  const records = useProject((s) => s.records);
  const projectId = useProject((s) => s.project?.projectId ?? null);
  const boards = projectId ? boardsLinkedTo(records, projectId, kind, id) : [];
  if (boards.length === 0) return null;
  return (
    <div data-linked-boards={kind} role="group" aria-label={name ? t('moodboard.links.boardsLinkedFor', { name }) : t('moodboard.links.boardsLinked')} className="flex flex-wrap items-center gap-1">
      {label && <span className="sb-label">{t('moodboard.links.boardsLinked')}</span>}
      {boards.map((board) => (
        <button
          key={board.id}
          type="button"
          data-linked-board={board.id}
          onClick={() => {
            moodboardStore.getState().openBoard(board.id);
            showWorkspace('moodboard');
          }}
          className="border-[1.5px] border-text px-2 py-0.5 text-[12px] font-semibold hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          <span data-user-text="">{boardTitle(board)}</span>
        </button>
      ))}
    </div>
  );
}
