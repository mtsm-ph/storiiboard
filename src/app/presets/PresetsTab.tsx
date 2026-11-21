import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { t } from '../../core/i18n';
import { nextPresetName, presetNamed, presetsOf, type Preset } from '../../core/model/settingsPreset';
import { Button, IconButton } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { SaveGlyph } from '../../ui/glyphs';
import { InAppWindow } from '../../ui/InAppWindow';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { ask } from '../ask';
import { showInfo } from '../notice';
import { projectStore, useProject } from '../projectStore';
import { presetDiff, presetLeftOut, readPreset } from './presetDiff';
import { applyPreset, beforeName, deletePreset, presetSettingsNow, renamePreset, savePreset } from './presets';
import { useHasDrafts } from '../settings/drafts';

// Settings presets in the Settings window (6.5.8): the header's Save preset… button, the Presets tab listing this
// project's presets (Apply…, a name to rename, Delete), and the two windows they open: the name to save under, and what
// applying would change. Both open over Settings as windows of their own (drawn beside it at the shell's root, so focus
// starts in their own body), and Settings stays as it was behind them.

const windows = createStore<{ saving: boolean; applying: string | null }>()(() => ({ saving: false, applying: null }));

const openSave = () => {
  windows.setState({ saving: true });
};
const closeSave = () => {
  windows.setState({ saving: false });
};
const closeApply = () => {
  windows.setState({ applying: null });
};

const defaultName = (n: number): string => t('presets.defaultName', { number: n });

/** The header's save icon: enabled while a project is open, since a preset lives in one. */
export function SavePresetButton() {
  const open = useProject((s) => s.project !== null);
  return (
    <IconButton size="sm" label={t('presets.saveDots')} disabled={!open} onClick={openSave} data-save-preset="">
      <SaveGlyph />
    </IconButton>
  );
}

/** The Presets tab. */
export function PresetsTab() {
  const projectId = useProject((s) => s.project?.projectId);
  const records = useProject((s) => s.records);
  const listId = useId();
  if (!projectId) return <p className="p-3 text-[13px]">{t('presets.noProject')}</p>;
  const presets = presetsOf(records, projectId);
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-[13px]">{t('presets.intro')}</p>
      <p className="text-[13px]">{t('presets.leftOut')}</p>
      <div>
        <Button variant="primary" onClick={openSave} data-presets-save="">
          {t('presets.saveDots')}
        </Button>
      </div>
      <section aria-labelledby={listId} className="flex flex-col">
        <h3 id={listId} className="sb-label border-b-[1.5px] border-text pb-1">
          {t('presets.listTitle')}
        </h3>
        {presets.length === 0 ? (
          <p className="py-2 text-[13px]">{t('presets.none')}</p>
        ) : (
          <ul aria-labelledby={listId}>
            {presets.map((preset) => (
              <PresetRow key={preset.id} preset={preset} ids={presets.map((p) => p.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Renames from the field; an empty name or another preset's puts back the one kept, the second said. */
async function commitName(preset: Preset, field: HTMLInputElement): Promise<void> {
  const typed = field.value;
  if (typed.trim() === '' || typed === preset.name) {
    field.value = preset.name;
    return;
  }
  const { project, records } = projectStore.getState();
  const other = project ? presetNamed(records, project.projectId, typed) : null;
  if (other && other.id !== preset.id) {
    field.value = preset.name;
    showInfo(t('presets.nameTaken', { name: other.name }));
    return;
  }
  await renamePreset(preset.id, typed);
}

function PresetRow({ preset, ids }: { preset: Preset; ids: readonly string[] }) {
  const field = useRef<HTMLInputElement>(null);
  // A name changed elsewhere (undo, History) shows in the field, never remounting it: a rename with Enter keeps focus.
  useEffect(() => {
    const input = field.current;
    if (input && document.activeElement !== input && input.value !== preset.name) input.value = preset.name;
  }, [preset.name]);
  const remove = async () => {
    const at = ids.indexOf(preset.id);
    const next = ids[at + 1] ?? ids[at - 1];
    if (!(await deletePreset(preset.id))) return;
    showInfo(t('presets.deleted', { name: preset.name }));
    requestAnimationFrame(() => {
      const target = next ? document.querySelector<HTMLElement>(`[data-preset-apply="${CSS.escape(next)}"]`) : null;
      (target ?? document.querySelector<HTMLElement>('[data-presets-save]'))?.focus();
    });
  };
  return (
    <li className="flex flex-wrap items-end gap-2 border-b border-border py-2">
      <div className="min-w-0 flex-1">
        <TextField
          label={t('presets.name')}
          aria-label={t('presets.nameOf', { name: preset.name })}
          ref={field}
          defaultValue={preset.name}
          autoComplete="off"
          maxLength={120}
          onBlur={(event) => {
            void commitName(preset, event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitName(preset, event.currentTarget);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          data-preset-apply={preset.id}
          aria-label={t('presets.applyNamed', { name: preset.name })}
          onClick={() => {
            windows.setState({ applying: preset.id });
          }}
        >
          {t('presets.applyDots')}
        </Button>
        <Button variant="warning" aria-label={t('presets.deleteNamed', { name: preset.name })} onClick={() => void remove()}>
          {t('presets.delete')}
        </Button>
      </div>
    </li>
  );
}

/** The windows Save preset… and Apply… open, drawn once at the shell's root. */
export function PresetWindows() {
  const { saving, applying } = useStore(windows);
  return (
    <>
      {saving && <SaveWindow />}
      {applying !== null && <ApplyWindow id={applying} />}
    </>
  );
}

function SaveWindow() {
  const projectId = useProject((s) => s.project?.projectId);
  const [name, setName] = useState(() => (projectId ? nextPresetName(projectStore.getState().records, projectId, defaultName) : defaultName(1)));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const { project, records } = projectStore.getState();
    if (!project || busy) return;
    const same = presetNamed(records, project.projectId, name);
    if (same) {
      const answer = await ask({
        title: t('presets.replaceTitle', { name: same.name }),
        text: t('presets.replaceText'),
        choices: [
          { id: 'cancel', label: t('common.cancel') },
          { id: 'replace', label: t('presets.replace'), variant: 'primary' },
        ],
        cancel: 'cancel',
      });
      if (answer !== 'replace') return;
    }
    setBusy(true);
    const written = await savePreset(name);
    setBusy(false);
    if (!written) return;
    closeSave();
    showInfo(t(same ? 'presets.replaced' : 'presets.saved', { name: same?.name ?? name.trim() }));
  };
  return (
    <InAppWindow title={t('presets.saveTitle')} onClose={closeSave} width={460}>
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="text-[13px]">{t('presets.saveText')}</p>
        <TextField
          label={t('presets.name')}
          value={name}
          autoComplete="off"
          maxLength={120}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={closeSave}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={name.trim() === '' || busy || !projectId}>
            {t('presets.save')}
          </Button>
        </div>
      </form>
    </InAppWindow>
  );
}

function ApplyWindow({ id }: { id: string }) {
  const projectId = useProject((s) => s.project?.projectId);
  const records = useProject((s) => s.records);
  const { setPreference } = useTheme();
  const [busy, setBusy] = useState(false);
  const waiting = useHasDrafts();
  const preset = projectId ? presetsOf(records, projectId).find((p) => p.id === id) : undefined;
  // Gone (deleted, undone, another project opened): the window's state goes too, so an undo never reopens it by itself.
  useEffect(() => {
    if (!preset) closeApply();
  }, [preset]);
  if (!preset || !projectId) return null;
  const apply = async () => {
    setBusy(true);
    const before = await applyPreset(id, setPreference);
    setBusy(false);
    if (before === null) return;
    closeApply();
    showInfo(t('presets.applied', { name: preset.name, before }));
  };
  return <ApplyView preset={preset} before={beforeName(records, projectId, id)} busy={busy} draftsWaiting={waiting} onApply={() => void apply()} />;
}

/** What applying a preset would change, and its Apply: drawn from what it's given, so a test renders it as it is. */
/** `draftsWaiting`: changes wait for Apply in Settings, which applying the preset discards (Kevin, Nov 17), said first. */
export function ApplyView({ preset, before, busy, draftsWaiting = false, onApply }: { preset: Preset; before: string; busy: boolean; draftsWaiting?: boolean; onApply: () => void }) {
  const textId = useId();
  const read = readPreset(preset.record);
  const lines = read.tooLarge ? [] : presetDiff(presetSettingsNow(), read.settings);
  const leftOut = presetLeftOut(read);
  return (
    <InAppWindow title={t('presets.applyTitle', { name: preset.name })} onClose={closeApply} width={520} describedBy={textId}>
      <div className="flex flex-col gap-3 p-4">
        <div id={textId} className="flex flex-col gap-3">
          {read.tooLarge ? null : lines.length === 0 ? (
            <p className="text-[13px]">{t('presets.nothing')}</p>
          ) : (
            <>
              <p className="text-[13px]">{t('presets.applyIntro')}</p>
              <ul aria-label={t('presets.changesLabel')} className="flex flex-col gap-1 border-[1.5px] border-text p-3">
                {lines.map((line) => (
                  <li key={line} className="text-[13px]">
                    {line}
                  </li>
                ))}
              </ul>
              <p className="text-[13px]">{t('presets.applyBefore', { before })}</p>
              {draftsWaiting && (
                <p className="text-[13px]" data-preset-drafts="">
                  {t('presets.applyDiscardsDrafts')}
                </p>
              )}
            </>
          )}
          {leftOut.map((note) => (
            <p key={note} className="text-[13px]">
              {note}
            </p>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={closeApply}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={lines.length === 0 || busy} onClick={onApply}>
            {t('presets.apply')}
          </Button>
        </div>
      </div>
    </InAppWindow>
  );
}
