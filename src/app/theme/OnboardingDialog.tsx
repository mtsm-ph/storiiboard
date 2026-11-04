import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { cssVariables, themeFor } from '../../ui/theme/generator/generate';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { showNotice } from '../notice';
import { fromFile, type PictureFile } from '../pictures';
import { projectStore, useProject } from '../projectStore';
import { closeOnboarding, useOnboardingProject } from './onboarding';
import { ThemeChooser, type ThemeChoice } from './ThemeChooser';
import { prepareThemeImage, setTheme, type ThemeImage } from './themeEdits';
import { ThemeImageWell } from './ThemeImageWell';

// The new project's first step (1.16, docs/PLAN.md B): an optional logo or key image, an accent from it, light or
// dark, with the theme previewed live. Create writes the image and the theme in the project's first op group; Skip
// keeps the kit's look, which Settings → Theme can change later.

export function OnboardingHost() {
  const forProject = useOnboardingProject();
  const project = useProject((s) => s.project);
  // Only for the project it was opened for: another one opened meanwhile (a double-click in Finder) never gets it.
  if (!forProject || project?.projectId !== forProject) return null;
  return <OnboardingDialog key={project.projectId} name={project.name} />;
}

function OnboardingDialog({ name }: { name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { resolved } = useTheme();
  const [choice, setChoice] = useState<ThemeChoice>({ accent: null, mode: resolved });
  const [image, setImage] = useState<ThemeImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // The latest image picked wins; one still being read when the dialog goes is freed as soon as it's ready.
  const reading = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    // Set again on every mount: StrictMode mounts twice in development.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      // What opened it (New project…) is gone with the Projects screen, and focus is still on a button inside the
      // dialog: it goes to the workspace's own section instead of falling to the page.
      const focused = document.activeElement;
      if (element?.open) element.close();
      if (!focused || focused === document.body || element?.contains(focused)) {
        document.querySelector<HTMLElement>('[id^="section-"][aria-current="page"]')?.focus();
      }
    };
  }, []);

  // The image's preview URL is freed when another replaces it or the dialog goes.
  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.previewUrl);
  }, [image]);

  // In the browser build, a picture dropped anywhere on the dialog is the image (the desktop app's drops come through
  // the well's window listener instead; pastes, through the well's listener on the dialog). Registered once; it reads
  // the latest handler.
  const latest = useRef<(files: PictureFile[]) => void>(() => undefined);
  useEffect(() => {
    const element = dialog.current;
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const dropped = (event: DragEvent) => {
      event.preventDefault();
      latest.current([...(event.dataTransfer?.files ?? [])].slice(0, 1).map(fromFile));
    };
    element?.addEventListener('dragover', over);
    element?.addEventListener('drop', dropped);
    return () => {
      element?.removeEventListener('dragover', over);
      element?.removeEventListener('drop', dropped);
    };
  }, []);

  const onFiles = (files: PictureFile[]) => {
    const [file] = files;
    if (!file) return;
    const ticket = ++reading.current;
    setBusy(true);
    prepareThemeImage(file)
      .then((next) => {
        if (!mounted.current || ticket !== reading.current) {
          URL.revokeObjectURL(next.previewUrl);
          return;
        }
        setImage(next);
        // The most saturated accent is the default, as the plan has it; none for a grey image keeps the kit.
        setChoice((current) => ({ ...current, accent: next.candidates[0] ?? null }));
      })
      .catch(showNotice)
      .finally(() => {
        if (mounted.current && ticket === reading.current) setBusy(false);
      });
  };

  useLayoutEffect(() => {
    latest.current = onFiles;
  });

  const create = () => {
    const { project } = projectStore.getState();
    if (!project) return;
    // Nothing changed from the kit in the mode it's already in: nothing to write.
    if (!image && !choice.accent && choice.mode === resolved) {
      closeOnboarding();
      return;
    }
    setSaving(true);
    void projectStore
      .getState()
      .applyWith((records) =>
        setTheme(
          records,
          project.projectId,
          { accent: choice.accent, mode: choice.mode, ...(image ? { image } : {}) },
          { projectPath: project.file.path, osDark: resolved === 'dark' },
        ),
      )
      // Not written (an error, shown as a notice): the dialog stays, with the choice, to try again or skip.
      .then((written) => {
        if (written) closeOnboarding();
      })
      .finally(() => {
        setSaving(false);
      });
  };

  // The dialog itself wears the theme being chosen, in the mode picked, as the plan has it: a live preview.
  const preview = cssVariables(themeFor(choice.accent)[choice.mode]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      data-theme={choice.mode}
      style={preview}
      onCancel={(event) => {
        // Escape is Skip: the project exists already, with the kit's look.
        event.preventDefault();
        closeOnboarding();
      }}
      className="m-auto max-h-none w-[560px] max-w-[calc(100vw-32px)] border-[1.5px] border-text bg-surface p-0 text-text backdrop:bg-text/40"
    >
      <div className="flex flex-col gap-4 p-4">
        <h2 id={titleId} className="text-[20px] font-bold">
          Set up {name}
        </h2>
        <p className="text-[13px] text-text-muted">
          A logo or key image gives the project its colours. You can skip this and change it later in Settings → Theme.
        </p>
        <ThemeChooser
          candidates={image?.candidates ?? []}
          choice={choice}
          onChange={setChoice}
          busy={busy}
          image={<ThemeImageWell url={image?.previewUrl ?? null} name={image?.source.name ?? null} onFiles={onFiles} takeAnyDrop />}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={closeOnboarding}>Skip</Button>
          <Button variant="primary" disabled={busy || saving} onClick={create}>
            Create
          </Button>
        </div>
      </div>
    </dialog>
  );
}
