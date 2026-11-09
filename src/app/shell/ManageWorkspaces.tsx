import { useId, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { t } from '../../core/i18n';
import { MAX_CUSTOM_WORKSPACES } from '../../core/storage/settings';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { InAppWindow } from '../../ui/InAppWindow';
import { confirmForGood } from '../ask';
import { layoutsOf, layoutStore } from './docking/layoutStore';
import {
  canAddCustomWorkspace,
  copyNameOf,
  closeDepartmentWorkspace,
  createCustomWorkspace,
  deleteCustomWorkspace,
  renameCustomWorkspace,
  showWorkspace,
  useWorkspaceState,
} from './workspaceStore';
import { departmentWorkspaceId, sectionId, WORKSPACE_PANEL_ID, WORKSPACES, workspaceById, type CustomWorkspaceId, type WorkspaceId } from './workspaces';

// Manage workspaces… (3.6d), an in-app window from the Layout menu: the person's own workspaces, to rename, open,
// duplicate or delete, and the built-in ones (the sections and the department workspaces in the sidebar), to open or
// duplicate as a start for one of their own. Workspaces are the person's, kept in this computer's settings: every
// project shows the same ones, and nothing here is an edit to a project, so ⌘Z never touches it.

const windowStore = createStore<{ open: boolean }>()(() => ({ open: false }));

export function openManageWorkspaces(): void {
  windowStore.setState({ open: true });
}

function closeManageWorkspaces(): void {
  windowStore.setState({ open: false });
}

/** A new workspace from another one's layout as it is now, named "<name> copy", with focus on its name to rename it. */
function duplicate(from: WorkspaceId): CustomWorkspaceId | null {
  const source = workspaceById(from);
  const id = createCustomWorkspace(copyNameOf(source.label), layoutsOf(layoutStore.getState().layouts, from).current, source.order);
  if (id) {
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLInputElement>(`[data-workspace-name="${CSS.escape(id)}"]`);
      field?.focus();
      field?.select();
    });
  }
  return id;
}

/**
 * Runs once a window closing now has given focus back (it does so a frame after it goes), so focus lands where this
 * says rather than on what opened the window.
 */
export function afterWindowCloses(focus: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(focus);
  });
}

/** Focus, once the list has drawn again, on what took a row's place: the row after it, else the one before, else `fallback`. */
function focusAfter(ids: readonly string[], gone: string, fallback: string): void {
  const at = ids.indexOf(gone);
  const next = ids[at + 1] ?? ids[at - 1];
  afterWindowCloses(() => {
    const target = next ? document.querySelector<HTMLElement>(`[data-manage-open="${CSS.escape(next)}"]`) : null;
    (target ?? document.querySelector<HTMLElement>(fallback))?.focus();
  });
}

/** Shows a workspace and closes the window, with focus on its sidebar entry once it's drawn. */
function open(id: WorkspaceId): void {
  closeManageWorkspaces();
  showWorkspace(id);
  afterWindowCloses(() => (document.getElementById(sectionId(id)) ?? document.getElementById(WORKSPACE_PANEL_ID))?.focus());
}

/** Renames from a name field; an empty or refused name puts back the one kept. */
function commitName(id: CustomWorkspaceId, field: HTMLInputElement): void {
  renameCustomWorkspace(id, field.value);
  const kept = workspaceById(id).label;
  if (field.value !== kept) field.value = kept;
}

function Row({ name, children }: { name: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-end gap-2 border-b border-border py-2">
      <div className="min-w-0 flex-1">{name}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </li>
  );
}

export function ManageWorkspacesHost() {
  const isOpen = useStore(windowStore, (s) => s.open);
  if (!isOpen) return null;
  return <ManageWorkspacesWindow />;
}

function ManageWorkspacesWindow() {
  const customs = useWorkspaceState((s) => s.customs);
  const departments = useWorkspaceState((s) => s.departments);
  const active = useWorkspaceState((s) => s.active);
  const yoursId = useId();
  const builtInId = useId();
  const full = customs.length >= MAX_CUSTOM_WORKSPACES;
  const activeLabel = workspaceById(active).label;
  const builtIn = [...WORKSPACES.map((w) => w.id), ...departments.map(departmentWorkspaceId)];

  const remove = async (id: CustomWorkspaceId, name: string) => {
    if (!(await confirmForGood(t('manageWorkspaces.deleteTitle', { name }), t('manageWorkspaces.deleteText'), t('manageWorkspaces.delete')))) return;
    focusAfter(customs.map((c) => c.id), id, '[data-manage-save]');
    deleteCustomWorkspace(id);
  };

  return (
    <InAppWindow title={t('manageWorkspaces.title')} onClose={closeManageWorkspaces} width={640}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="text-[13px]">{t('manageWorkspaces.intro')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            data-manage-save=""
            disabled={!canAddCustomWorkspace()}
            onClick={() => {
              duplicate(active);
            }}
          >
            {t('manageWorkspaces.saveCurrent', { name: activeLabel })}
          </Button>
          {full && <p className="text-[12px] text-text-muted">{t('manageWorkspaces.full', { count: MAX_CUSTOM_WORKSPACES })}</p>}
        </div>

        <section aria-labelledby={yoursId} className="flex flex-col">
          <h3 id={yoursId} className="sb-label border-b-[1.5px] border-text pb-1">
            {t('manageWorkspaces.yours')}
          </h3>
          {customs.length === 0 ? (
            <p className="py-2 text-[13px] text-text-muted">{t('manageWorkspaces.none')}</p>
          ) : (
            <ul>
              {customs.map((custom) => (
                <Row
                  key={custom.id}
                  name={
                    <TextField
                      label={t('manageWorkspaces.name')}
                      // Each row's field by its workspace, so a screen reader tells them apart.
                      aria-label={t('manageWorkspaces.nameOf', { name: custom.name })}
                      defaultValue={custom.name}
                      data-workspace-name={custom.id}
                      autoComplete="off"
                      onBlur={(event) => {
                        commitName(custom.id, event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        // Renames and stays in the field, so Tab goes on from here.
                        if (event.key === 'Enter') commitName(custom.id, event.currentTarget);
                      }}
                    />
                  }
                >
                  <Button data-manage-open={custom.id} onClick={() => { open(custom.id); }} aria-label={t('manageWorkspaces.openNamed', { name: custom.name })}>
                    {t('manageWorkspaces.open')}
                  </Button>
                  <Button disabled={full} onClick={() => { duplicate(custom.id); }} aria-label={t('manageWorkspaces.duplicateNamed', { name: custom.name })}>
                    {t('manageWorkspaces.duplicate')}
                  </Button>
                  <Button variant="warning" onClick={() => { void remove(custom.id, custom.name); }} aria-label={t('manageWorkspaces.deleteNamed', { name: custom.name })}>
                    {t('manageWorkspaces.deleteDots')}
                  </Button>
                </Row>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={builtInId} className="flex flex-col">
          <h3 id={builtInId} className="sb-label border-b-[1.5px] border-text pb-1">
            {t('manageWorkspaces.builtIn')}
          </h3>
          <ul>
            {builtIn.map((id) => {
              const { label } = workspaceById(id);
              const department = departments.find((d) => departmentWorkspaceId(d) === id);
              return (
                <Row key={id} name={<span className="text-[13px] font-semibold">{label}</span>}>
                  <Button data-manage-open={id} onClick={() => { open(id); }} aria-label={t('manageWorkspaces.openNamed', { name: label })}>
                    {t('manageWorkspaces.open')}
                  </Button>
                  <Button disabled={full} onClick={() => { duplicate(id); }} aria-label={t('manageWorkspaces.duplicateNamed', { name: label })}>
                    {t('manageWorkspaces.duplicate')}
                  </Button>
                  {department && (
                    <Button
                      onClick={() => {
                        focusAfter(builtIn, id, '[data-manage-save]');
                        closeDepartmentWorkspace(department);
                      }}
                      aria-label={t('manageWorkspaces.removeNamed', { name: label })}
                    >
                      {t('layoutMenu.removeFromSidebar')}
                    </Button>
                  )}
                </Row>
              );
            })}
          </ul>
        </section>
      </div>
    </InAppWindow>
  );
}
