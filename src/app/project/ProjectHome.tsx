import { useId } from 'react';
import { isProjectRole, type ProjectRole } from '../../core/model/departmentStatus';
import { ROLE_LABELS, ROLES } from '../../core/model/role';
import { useProfile } from '../settings/profileStore';
import { setProjectRole, useProjectRoleSet } from '../settings/projectRole';
import type { Props, SbdRecord } from '../../core/model/record';
import { PROJECT_STATE_LABEL, PROJECT_STATES, projectStateOf } from '../../core/model/project';
import { ASPECT_RATIOS, projectStoryboard } from '../../core/model/storyboard';
import { setLettersAllowIO } from '../../features/storyboard/board';
import { Select, TextField, Toggle } from '../../ui/fields';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { useProject } from '../projectStore';
import { localizeError, t } from '../../core/i18n';

// The Project tile in Settings: the project's state, title and notes, and the storyboard's frame shape and shot
// letters. Every change is an op, so ⌘Z takes it back.

export function ProjectHome() {
  const projectId = useProject((s) => s.project?.projectId);
  const record = useProject((s) => (projectId ? s.records[projectId] : undefined));
  const apply = useProject((s) => s.apply);
  const applyWith = useProject((s) => s.applyWith);
  const error = useProject((s) => s.error);
  if (!record || !projectId) return <p className="sb-label p-3 text-text-muted">{t('projectHome.noProjectOpen')}</p>;
  return (
    <>
      <YourRole projectId={projectId} />
      <ProjectFields
        record={record}
        error={error}
        onChange={(set) => {
          void apply([{ kind: 'update', id: record.id, set }]);
        }}
        onLettersChange={(allowIO) => {
          // Renumbers every unlocked scene in the same edit.
          // From the records and slate numbers as they are at its turn, like every renumbering edit.
          void applyWith((now, slate) => ({ changes: setLettersAllowIO(now, record.id, allowIO, slate) }));
        }}
      />
    </>
  );
}

/**
 * Your role on this project (polish 6): the person's, kept on this computer, so not an op and not in the file. It
 * takes the place of the profile's usual role here: the director or the DP approves departments on a shot.
 */
function YourRole({ projectId }: { projectId: string }) {
  const set = useProjectRoleSet(projectId);
  const usual = useProfile().role;
  const noteId = useId();
  return (
    <div className="flex max-w-[640px] flex-col gap-1.5 border-b border-text p-4">
      <Select
        label={t('projectHome.yourRole')}
        aria-describedby={noteId}
        value={set ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setProjectRole(projectId, isProjectRole(value) ? value : null);
        }}
      >
        <option value="">{usual ? t('projectHome.usualRole', { role: ROLE_LABELS[usual] }) : t('projectHome.usualRoleNone')}</option>
        {PROJECT_ROLES.map((role) => (
          <option key={role} value={role}>
            {role === 'director-dp' ? t('projectHome.directorAndDp') : ROLE_LABELS[role]}
          </option>
        ))}
      </Select>
      <p id={noteId} className="text-[12px] text-text-muted">
        {t('projectHome.yourRoleNote')}
      </p>
    </div>
  );
}

/** The roles in the profile's order, with director and DP together after the DP. */
const PROJECT_ROLES: readonly ProjectRole[] = ROLES.flatMap((role): ProjectRole[] => (role === 'dp' ? [role, 'director-dp'] : [role]));

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
          label={t('projectHome.state')}
          options={PROJECT_STATES.map((value) => ({ value, label: PROJECT_STATE_LABEL[value] }))}
          value={projectStateOf(record.props)}
          onChange={(state) => {
            onChange({ state });
          }}
        />
        <div className="grid grid-cols-[minmax(0,200px)_1fr] items-end gap-4">
          <Select
            label={t('projectHome.aspectRatio')}
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
            label={t('projectHome.useIAndOIn')}
            checked={!storyboard.skipIO}
            onChange={(allow) => {
              if (onLettersChange) onLettersChange(allow);
              else onChange({ shot_letters_allow_io: allow });
            }}
          />
        </div>
        <p className="-mt-2 text-[12px] text-text-muted">
          {t('projectHome.framesTakeTheSceneNumber')}
        </p>
        {/* Keyed by the record's last change, so an undo or redo shows in the fields at once. */}
        <div key={record.updatedAt} className="flex flex-col gap-4">
          <TextField
            label={t('projectHome.title')}
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
              {t('projectHome.notes')}
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
              {localizeError(error)}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
