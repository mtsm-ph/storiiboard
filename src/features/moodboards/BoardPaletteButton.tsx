import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';
import type { SbdRecord } from '../../core/model/record';
import { Menu, MenuGroup, MenuItem } from '../../ui/Menu';
import { useGenerating } from '../storyboard/palette/actions';
import { boardScenes, canMakePalette, makePaletteFromBoard } from './boardPalette';

// "Make palette from this board" on a board's strip (5.6b): for a moodboard linked to a scene (5.4). One scene is made at once; a
// board linked to several asks which. Nothing shows for a board linked to none, or for a deck. While a palette is being made for a
// scene the button says so and waits (aria-disabled, so a keyboard user keeps focus), and a second press writes nothing.

const CLASS = 'sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4';

function Single({ boardId, scene }: { boardId: string; scene: SbdRecord }) {
  const busy = useGenerating(scene.id);
  return (
    <button
      type="button"
      data-board-palette=""
      className={CLASS}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) void makePaletteFromBoard(boardId, scene.id);
      }}
    >
      {busy ? t('palette.generating') : t('palette.board.make')}
    </button>
  );
}

function SceneItem({ boardId, scene, close }: { boardId: string; scene: SbdRecord; close: () => void }) {
  const busy = useGenerating(scene.id);
  return (
    <MenuItem
      aria-disabled={busy || undefined}
      onClick={() => {
        close();
        if (!busy) void makePaletteFromBoard(boardId, scene.id);
      }}
    >
      {sceneLabel(sceneFields(scene.props).number)}
      {busy ? ` ${t('palette.generating')}` : ''}
    </MenuItem>
  );
}

export function BoardPaletteButton({ boardId }: { boardId: string }) {
  const records = useProject((s) => s.records);
  const board = records[boardId];
  const scenes = board && canMakePalette(board) ? boardScenes(records, board) : [];
  const [only] = scenes;
  if (!only) return null;
  if (scenes.length === 1) return <Single boardId={boardId} scene={only} />;
  return (
    <div className="flex h-7" data-board-palette="">
      <Menu label={t('palette.board.make')} buttonClassName={CLASS} panelClassName="w-44">
        {(close) => (
          <MenuGroup>
            {scenes.map((scene) => (
              <SceneItem key={scene.id} boardId={boardId} scene={scene} close={close} />
            ))}
          </MenuGroup>
        )}
      </Menu>
    </div>
  );
}
