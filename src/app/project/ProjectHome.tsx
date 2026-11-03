import { useId } from 'react';
import type { Props, SbdRecord } from '../../core/model/record';
import { TextField } from '../../ui/fields';
import { useProject } from '../projectStore';

// The Project tile in Settings: the project's title and notes, enough to edit real material, force-quit and undo
// in Phase 0 (docs/PLAN.md, 0.5 and 0.7). With + Add Scene in the sidebar, it's Phase 0's edit surface.

export function ProjectHome() {
  const projectId = useProject((s) => s.project?.projectId);
  const record = useProject((s) => (projectId ? s.records[projectId] : undefined));
  const apply = useProject((s) => s.apply);
  const error = useProject((s) => s.error);
  if (!record) return <p className="sb-label p-3 text-muted">No project open.</p>;
  return (
    <ProjectFields
      record={record}
      error={error}
      onChange={(set) => {
        void apply([{ kind: 'update', id: record.id, set }]);
      }}
    />
  );
}

interface ProjectFieldsProps {
  record: SbdRecord;
  error: string | null;
  onChange: (set: Props) => void;
}

export function ProjectFields({ record, error, onChange }: ProjectFieldsProps) {
  const notesId = useId();
  const title = typeof record.props.title === 'string' ? record.props.title : '';
  const notes = typeof record.props.notes === 'string' ? record.props.notes : '';
  // One field edit is one op, committed when the field is left; typing doesn't fill the History with keystrokes.
  const commit = (prop: 'title' | 'notes', value: string, current: string) => {
    if (value !== current) onChange({ [prop]: value });
  };

  return (
    <>
      {/* Keyed by the record's last change, so an undo or redo shows in the fields at once. */}
      <div key={record.updatedAt} className="flex max-w-[640px] flex-col gap-4 p-4">
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
            className="w-full border border-ink bg-oatmeal px-2.5 py-2 text-[13px] text-ink"
          />
        </div>
        {error && (
          <p role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
