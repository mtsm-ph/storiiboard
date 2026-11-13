import { useEffect, useId, useRef, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { boardFields, boardsOf, boardTitle, departmentBoard, departmentsWithoutBoard } from './boards';
import { createBoard, openDepartment } from './boardActions';
import { moodboardStore } from './moodboardStore';

// The Moodboard tile with no board open (decision 2): the boards that exist, then the departments with no board yet
// (opening one makes it, or brings it back from the Trash), then New board, which asks a name.

export function BoardPicker({ projectId }: { projectId: string }) {
  const records = useProject((s) => s.records);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const nameField = useRef<HTMLInputElement>(null);
  // The field takes focus as it appears, so a name can be typed at once.
  useEffect(() => {
    if (naming) nameField.current?.focus();
  }, [naming]);
  const boardsId = useId();
  const departmentsId = useId();
  const boards = boardsOf(records, projectId);
  const departments = departmentsWithoutBoard(records, projectId);

  // Muted tags turn to ink on the oatmeal hover: muted text never sits on oatmeal.
  const rowClass = 'group flex h-9 w-full items-center gap-2 border-b border-border px-3 text-left text-[13px] hover:bg-surface-raised focus-visible:-outline-offset-4';
  const tagClass = 'sb-label ml-auto font-normal text-text-muted group-hover:text-text';

  return (
    <div className="flex flex-col">
      {boards.length > 0 && (
        <section aria-labelledby={boardsId}>
          <h2 id={boardsId} className="sb-label px-3 pt-3 pb-1 text-text-muted">
            {t('moodboard.boards')}
          </h2>
          <ul>
            {boards.map((board) => (
              <li key={board.id}>
                <button
                  type="button"
                  data-board-open={board.id}
                  className={rowClass}
                  onClick={() => {
                    moodboardStore.getState().openBoard(board.id);
                  }}
                >
                  <span data-user-text="" className="truncate">{boardTitle(board)}</span>
                  {boardFields(board.props).department !== null && <span className={tagClass}>{t('moodboard.departmentBoard')}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {departments.length > 0 && (
        <section aria-labelledby={departmentsId}>
          <h2 id={departmentsId} className="sb-label px-3 pt-3 pb-1 text-text-muted">
            {t('moodboard.startDepartment')}
          </h2>
          <ul>
            {departments.map((department) => {
              const inTrash = departmentBoard(records, projectId, department) !== undefined;
              return (
                <li key={department}>
                  <button
                    type="button"
                    data-department-board={department}
                    className={rowClass}
                    onClick={() => {
                      void openDepartment(department);
                    }}
                  >
                    {DEPARTMENT_LABELS[department]}
                    {inTrash && <span className={tagClass}>{t('moodboard.inTrash')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="p-3">
        {naming ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() === '') return;
              void createBoard(name).then(() => {
                setNaming(false);
                setName('');
              });
            }}
          >
            <div className="min-w-0 flex-1">
              <TextField
                label={t('moodboard.boardName')}
                value={name}
                maxLength={80}
                ref={nameField}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setNaming(false);
                  }
                }}
              />
            </div>
            <Button type="submit" variant="primary" disabled={name.trim() === ''}>
              {t('moodboard.createBoard')}
            </Button>
            <Button
              onClick={() => {
                setNaming(false);
                setName('');
              }}
            >
              {t('moodboard.cancel')}
            </Button>
          </form>
        ) : (
          <Button
            data-new-board=""
            onClick={() => {
              setNaming(true);
            }}
          >
            {t('moodboard.newBoard')}
          </Button>
        )}
      </div>
    </div>
  );
}
