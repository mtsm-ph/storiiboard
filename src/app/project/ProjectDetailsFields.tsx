import { useId, useState } from 'react';
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

interface ProjectDetailsFieldsProps {
  record: SbdRecord;
  onChange: (set: Props) => void;
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
  const commit = (set: Props, changed: boolean) => {
    if (changed) onChange(set);
  };
  const text = (prop: 'logline' | 'format' | 'runtime', label: string) => (
    <TextField
      label={label}
      defaultValue={details[prop]}
      onBlur={(event) => {
        const value = event.currentTarget.value;
        commit({ [prop]: value }, value !== details[prop]);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
  const add = () => {
    const value = adding.trim();
    if (value === '') return;
    onChange(deliverablesChange(record.props, (items) => [...items, { id: crypto.randomUUID(), text: value, done: false }]));
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
          // No stage is a stage unset, not an empty one stored.
          onChange({ stage: isProjectStage(value) ? value : null });
        }}
      >
        <option value="">{t('projectDetails.noStage')}</option>
        {PROJECT_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {PROJECT_STAGE_LABEL[stage]}
          </option>
        ))}
      </Select>
      {/* Keyed by the record's last change, so an undo or redo shows in the fields at once. */}
      <div key={record.updatedAt} className="flex flex-col gap-4">
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
                key={field}
                label={label()}
                type={type}
                defaultValue={details.client[field]}
                onBlur={(event) => {
                  const value = event.currentTarget.value;
                  commit(clientChange(record.props, field, value), value !== details.client[field]);
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
          <ul aria-label={t('projectDetails.deliverables')} className="flex flex-col gap-1.5" data-deliverables="">
            {details.deliverables.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.done}
                  aria-label={t('projectDetails.deliverableDone', { text: item.text })}
                  onClick={() => {
                    onChange(deliverablesChange(record.props, (items) => items.map((i) => (i.id === item.id ? { ...i, done: !item.done } : i))));
                  }}
                  className="inline-flex size-[22px] shrink-0 items-center justify-center border border-text"
                >
                  {/* Ticked is a filled box, so it reads without colour. */}
                  {item.done && <span aria-hidden="true" className="size-[12px] bg-text" />}
                </button>
                <input
                  aria-label={t('projectDetails.deliverableText')}
                  defaultValue={item.text}
                  onBlur={(event) => {
                    const value = event.currentTarget.value;
                    if (value !== item.text) {
                      onChange(deliverablesChange(record.props, (items) => items.map((i) => (i.id === item.id ? { ...i, text: value } : i))));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                  className={`min-w-0 flex-1 border border-text bg-surface-raised px-2.5 py-1.5 text-[13px] text-text ${item.done ? 'line-through' : ''}`}
                />
                <IconButton
                  label={t('projectDetails.removeDeliverable', { text: item.text })}
                  onClick={() => {
                    onChange(deliverablesChange(record.props, (items) => items.filter((i) => i.id !== item.id)));
                  }}
                >
                  <CloseGlyph />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
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
