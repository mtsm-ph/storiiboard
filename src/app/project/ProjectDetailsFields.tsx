import { useId, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import {
  clientChange,
  deliverablesChange,
  isProjectStage,
  PROJECT_STAGE_LABEL,
  PROJECT_STAGES,
  projectDetails,
  type ClientContact,
} from '../../core/model/projectDetails';
import type { Props, SbdRecord } from '../../core/model/record';
import { Button, IconButton } from '../../ui/Button';
import { Select, TextField } from '../../ui/fields';
import { CloseGlyph } from '../../ui/glyphs';

// Production details in Settings → Project (3.1): the job's stage, logline, format and runtime, the client contact
// and the deliverables checklist. Each is one op when its field is left (or its box is ticked), so ⌘Z takes it back
// and History says what changed. The client's email and phone are private: shown here, never logged.
//
// Each edit is given as a change of the props as they'll be at its turn, not as they were when the field was drawn:
// two edits a moment apart (a rename, then a tick) both land. Each text field is keyed by its own stored value, so an
// undo or redo shows in it while the others, and the one with focus, stay as they are.

/** A change to the project's props, worked out from them as they are when it's applied. */
export type DetailsChange = (props: Props) => Props;

interface ProjectDetailsFieldsProps {
  record: SbdRecord;
  onChange: (change: DetailsChange) => void;
}

const CLIENT_FIELDS: readonly { field: keyof ClientContact; label: () => string; type?: string }[] = [
  { field: 'name', label: () => t('projectDetails.clientName') },
  { field: 'company', label: () => t('projectDetails.clientCompany') },
  { field: 'email', label: () => t('projectDetails.clientEmail'), type: 'email' },
  { field: 'phone', label: () => t('projectDetails.clientPhone'), type: 'tel' },
];

export function ProjectDetailsFields({ record, onChange }: ProjectDetailsFieldsProps) {
  const details = projectDetails(record.props);
  const headingId = useId();
  const [adding, setAdding] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const newField = useRef<HTMLDivElement>(null);
  /** After a row's Remove: the next row's box, else the one before, else the New deliverable field. */
  const focusAfterRemove = (index: number) => {
    const boxes = list.current?.querySelectorAll<HTMLButtonElement>('[role="checkbox"]') ?? [];
    const next = boxes[index + 1] ?? boxes[index - 1];
    if (next) next.focus();
    else newField.current?.querySelector('input')?.focus();
  };
  const text = (prop: 'logline' | 'format' | 'runtime', label: string) => (
    <TextField
      key={`${prop}:${details[prop]}`}
      label={label}
      defaultValue={details[prop]}
      onBlur={(event) => {
        const value = event.currentTarget.value;
        if (value !== details[prop]) onChange(() => ({ [prop]: value }));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
  const add = () => {
    const value = adding.trim();
    if (value === '') return;
    const id = crypto.randomUUID();
    onChange((props) => deliverablesChange(props, (items) => [...items, { id, text: value, done: false }]));
    setAdding('');
  };

  return (
    <section aria-labelledby={headingId} className="flex max-w-[640px] flex-col gap-4 border-t border-text p-4">
      <h3 id={headingId} className="sb-label">
        {t('projectDetails.heading')}
      </h3>
      <Select
        label={t('projectDetails.stage')}
        value={details.stage ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          // No stage is stored as null, which reads as none (docs/SBD_FORMAT.md).
          onChange(() => ({ stage: isProjectStage(value) ? value : null }));
        }}
      >
        <option value="">{t('projectDetails.noStage')}</option>
        {PROJECT_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {PROJECT_STAGE_LABEL[stage]}
          </option>
        ))}
      </Select>
      <div className="flex flex-col gap-4">
        {text('logline', t('projectDetails.logline'))}
        <div className="grid grid-cols-2 gap-4">
          {text('format', t('projectDetails.format'))}
          {text('runtime', t('projectDetails.runtime'))}
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="sb-label mb-2">{t('projectDetails.client')}</legend>
          <div className="grid grid-cols-2 gap-4">
            {CLIENT_FIELDS.map(({ field, label, type }) => (
              <TextField
                key={`${field}:${details.client[field]}`}
                label={label()}
                type={type}
                defaultValue={details.client[field]}
                onBlur={(event) => {
                  const value = event.currentTarget.value;
                  if (value !== details.client[field]) onChange((props) => clientChange(props, field, value));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="sb-label mb-2">{t('projectDetails.deliverables')}</legend>
          {details.deliverables.length === 0 && <p className="text-[12px] text-text-muted">{t('projectDetails.noDeliverables')}</p>}
          <ul ref={list} aria-label={t('projectDetails.deliverables')} className="flex flex-col gap-1.5" data-deliverables="">
            {details.deliverables.map((item, index) => (
              <li key={item.id} className="flex items-center gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={t('projectDetails.deliverableDone', { text: item.text })}
                  onClick={() => {
                    // Flipped from the item as it is at its turn: a quick second click flips it back.
                    onChange((props) => deliverablesChange(props, (items) => items.map((i) => (i.id === item.id ? { ...i, done: i.done !== true } : i))));
                  }}
                  className="inline-flex size-[24px] shrink-0 items-center justify-center border border-text"
                >
                  {/* Ticked is a filled box, so it reads without colour. */}
                  {item.done && <span aria-hidden="true" className="size-[14px] bg-text" />}
                </button>
                <input
                  key={`${item.id}:${item.text}`}
                  aria-label={t('projectDetails.deliverableText', { n: index + 1 })}
                  defaultValue={item.text}
                  onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    // Emptied, it keeps its text (Remove is the way to take one off); spaces typed round it go.
                    if (value === '' || value === item.text) {
                      event.currentTarget.value = item.text;
                      return;
                    }
                    onChange((props) => deliverablesChange(props, (items) => items.map((i) => (i.id === item.id ? { ...i, text: value } : i))));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  className={`min-w-0 flex-1 border border-text bg-surface-raised px-2.5 py-1.5 text-[13px] text-text ${item.done ? 'line-through' : ''}`}
                />
                <IconButton
                  label={t('projectDetails.removeDeliverable', { text: item.text })}
                  onClick={() => {
                    onChange((props) => deliverablesChange(props, (items) => items.filter((i) => i.id !== item.id)));
                    // Its row goes: focus to the next field rather than the page.
                    focusAfterRemove(index);
                  }}
                >
                  <CloseGlyph />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <div ref={newField} className="min-w-0 flex-1">
              <TextField
                label={t('projectDetails.newDeliverable')}
                value={adding}
                onChange={(event) => {
                  setAdding(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') add();
                }}
              />
            </div>
            <Button disabled={adding.trim() === ''} onClick={add}>
              {t('projectDetails.addDeliverable')}
            </Button>
          </div>
        </fieldset>
      </div>
    </section>
  );
}
