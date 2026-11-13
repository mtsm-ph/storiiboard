import { useEffect, useId, useRef, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { DEPARTMENT_LABELS } from '../../core/model/department';
import { Button } from '../../ui/Button';
import { Select, TextField } from '../../ui/fields';
import { createDeck } from './deckActions';
import { DECK_TEMPLATE_LABEL, DECK_TEMPLATES, isDeckTemplate, type DeckTemplate } from './deckTemplates';
import { isPageFormat, isPaper, PAGE_FORMAT_LABEL, PAGE_FORMATS, type PageFormat, type PageOrientation } from './pageFormats';
import { boardFields, boardsOf, boardTitle, departmentBoard, departmentsWithoutBoard } from './boards';
import { createBoard, openDepartment } from './boardActions';
import { moodboardStore } from './moodboardStore';

// The Moodboard tile with no board open (decision 2): the boards that exist, then the departments with no board yet
// (opening one makes it, or brings it back from the Trash), then New board, which asks a name.

export function BoardPicker({ projectId }: { projectId: string }) {
  const records = useProject((s) => s.records);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  // New deck (5.5): a name, a template and, for Blank, a page format.
  const [deckNaming, setDeckNaming] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [template, setTemplate] = useState<DeckTemplate>('treatment');
  const [format, setFormat] = useState<PageFormat>('16:9');
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const deckField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (deckNaming) deckField.current?.focus();
  }, [deckNaming]);
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
                  {boardFields(board.props).kind === 'deck' && <span className={tagClass}>{t('deck.tag')}</span>}
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
      <div className="flex flex-col gap-3 p-3">
        {deckNaming ? (
          <form
            data-new-deck-form=""
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (deckName.trim() === '') return;
              void createDeck(deckName, template, format, isPaper(format) ? orientation : 'portrait').then(() => {
                setDeckNaming(false);
                setDeckName('');
              });
            }}
          >
            <div className="min-w-48 flex-1">
              <TextField
                label={t('deck.name')}
                value={deckName}
                maxLength={80}
                ref={deckField}
                onChange={(event) => {
                  setDeckName(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setDeckNaming(false);
                  }
                }}
              />
            </div>
            <Select
              label={t('deck.template')}
              value={template}
              onChange={(event) => {
                if (isDeckTemplate(event.target.value)) setTemplate(event.target.value);
              }}
            >
              {DECK_TEMPLATES.map((id) => (
                <option key={id} value={id}>
                  {DECK_TEMPLATE_LABEL[id]}
                </option>
              ))}
            </Select>
            {template === 'blank' && (
              <>
                <Select
                  label={t('deck.pageFormat')}
                  value={format}
                  onChange={(event) => {
                    if (isPageFormat(event.target.value)) setFormat(event.target.value);
                  }}
                >
                  {PAGE_FORMATS.map((id) => (
                    <option key={id} value={id}>
                      {PAGE_FORMAT_LABEL[id]}
                    </option>
                  ))}
                </Select>
                {isPaper(format) && (
                  <Select
                    label={t('deck.orientation')}
                    value={orientation}
                    onChange={(event) => {
                      setOrientation(event.target.value === 'landscape' ? 'landscape' : 'portrait');
                    }}
                  >
                    <option value="portrait">{t('deck.orientation.portrait')}</option>
                    <option value="landscape">{t('deck.orientation.landscape')}</option>
                  </Select>
                )}
              </>
            )}
            <Button type="submit" variant="primary" disabled={deckName.trim() === ''}>
              {t('deck.create')}
            </Button>
            <Button
              onClick={() => {
                setDeckNaming(false);
                setDeckName('');
              }}
            >
              {t('moodboard.cancel')}
            </Button>
          </form>
        ) : (
          <div>
            <Button
              data-new-deck=""
              onClick={() => {
                setDeckNaming(true);
              }}
            >
              {t('deck.new')}
            </Button>
          </div>
        )}
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
