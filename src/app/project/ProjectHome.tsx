import { useId } from 'react';
import type { Props, SbdRecord } from '../../core/model/record';
import { PROJECT_STATE_LABEL, PROJECT_STATES, projectStateOf } from '../../core/model/project';
import { ASPECT_RATIOS, projectStoryboard } from '../../core/model/storyboard';
import { setLettersAllowIO } from '../../features/storyboard/board';
import { Select, TextField, Toggle } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useProject } from '../projectStore';

// The Project tile in Settings: the project's state, title and notes, and the storyboard's frame shape and shot
// letters. Every change is an op, so ⌘Z takes it back.

export function ProjectHome() {
  const projectId = useProject((s) => s.project?.projectId);
  const record = useProject((s) => (projectId ? s.records[projectId] : undefined));
  const apply = useProject((s) => s.apply);
  const records = useProject((s) => s.records);
  const error = useProject((s) => s.error);
  if (!record) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  return (
    <ProjectFields
      record={record}
      error={error}
      onChange={(set) => {
        void apply([{ kind: 'update', id: record.id, set }]);
      }}
      onLettersChange={(allowIO) => {
        // Renumbers every unlocked scene in the same edit.
        void apply(setLettersAllowIO(records, record.id, allowIO));
      }}
    />
  );
}

interface ProjectFieldsProps {
  record: SbdRecord;
  error: string | null;
  onChange: (set: Props) => void;
  /** Allow I and O in shot letters (true), or skip them as most slates do. */
  onLettersChange?: (allowIO: boolean) => void;
}

export function ProjectFields({ record, error, onChange, onLettersChange }: ProjectFieldsProps) {
  const storyboard = projectStoryboard(record.props);
  const notesId = useId();
  const title = typeof record.props.title === 'string' ? record.props.title : '';
  const notes = typeof record.props.notes === 'string' ? record.props.notes : '';
  // One field edit is one op, committed when the field is left; typing doesn't fill the History with keystrokes.
  const commit = (prop: 'title' | 'notes', value: string, current: string) => {
    if (value !== current) onChange({ [prop]: value });
  };

  return (
    <>
      <div className="flex max-w-[640px] flex-col gap-4 p-4">
        {/* An op like any edit: archiving undoes with ⌘Z. It sits outside the keyed block below, so arrowing
            through the states keeps focus on the control. */}
        <SegmentedControl
          label="State"
          options={PROJECT_STATES.map((value) => ({ value, label: PROJECT_STATE_LABEL[value] }))}
          value={projectStateOf(record.props)}
          onChange={(state) => {
            onChange({ state });
          }}
        />
        <div className="grid grid-cols-[minmax(0,200px)_1fr] items-end gap-4">
          <Select
            label="Aspect ratio"
            mono
            value={storyboard.aspectRatio}
            onChange={(event) => {
              onChange({ aspect_ratio: event.currentTarget.value });
            }}
          >
            {ASPECT_RATIOS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.id}
              </option>
            ))}
          </Select>
          <Toggle
            label="Use I and O in shot letters"
            checked={!storyboard.skipIO}
            onChange={(allow) => {
              if (onLettersChange) onLettersChange(allow);
              else onChange({ shot_letters_allow_io: allow });
            }}
          />
        </div>
        <p className="-mt-2 text-[12px] text-text-muted">
          Frames take the scene number and a letter: 4A, 4B. Most slates skip I and O, which read as 1 and 0.
        </p>
        {/* Keyed by the record's last change, so an undo or redo shows in the fields at once. */}
        <div key={record.updatedAt} className="flex flex-col gap-4">
          <TextField
            label="Title"
            defaultValue={title}
            onBlur={(event) => {
              commit('title', event.currentTarget.value, title);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          <div className="flex flex-col gap-[5px]">
            <label htmlFor={notesId} className="sb-label">
              Notes
            </label>
            <textarea
              id={notesId}
              rows={10}
              defaultValue={notes}
              onBlur={(event) => {
                commit('notes', event.currentTarget.value, notes);
              }}
              className="w-full border border-text bg-surface-raised px-2.5 py-2 text-[13px] text-text"
            />
          </div>
          {error && (
            <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
              {error}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
