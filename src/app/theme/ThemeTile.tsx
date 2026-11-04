import { useEffect, useId, useRef, useState } from 'react';
import { imageUrl } from '../../core/media/urls';
import { mediaFields } from '../../core/media/store';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { hex, parseHex } from '../../ui/theme/generator/color';
import { DEFAULT_ACCENT, themeFor } from '../../ui/theme/generator/generate';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { showNotice } from '../notice';
import type { PictureFile } from '../pictures';
import { projectStore, useProject } from '../projectStore';
import { ThemeChooser } from './ThemeChooser';
import { currentTheme, prepareThemeImage, resetTheme, setTheme, type ThemePatch } from './themeEdits';
import { ThemeImageWell } from './ThemeImageWell';

// Settings → Theme (1.16, docs/PLAN.md B): onboarding's controls for an open project, plus a manual accent (put
// through the same AA fit, with what was picked and what's used side by side), Regenerate and Reset to default. Each
// change is one op group, so ⌘Z takes it back, and each is worked out from the project as it is when it lands.

/** Six hex digits or three, with or without the #. */
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function ThemeTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const { resolved } = useTheme();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ sha256: string; url: string | null } | null>(null);
  // What's typed in the hex field, with the accent it was typed over: an undo that changes the accent clears it.
  const [typed, setTyped] = useState<{ value: string; over: string | null } | null>(null);
  const reading = useRef(0);
  const hexId = useId();

  const current = project ? currentTheme(records, project.projectId, resolved === 'dark') : null;
  const sha256 = current?.sha256 ?? null;
  const file = project?.file ?? null;
  useEffect(() => {
    if (!file || !sha256) return;
    let live = true;
    void imageUrl(file, sha256).then((url) => {
      if (live) setLoaded({ sha256, url });
    });
    return () => {
      live = false;
    };
  }, [file, sha256]);
  // Only the URL of the image the theme names now: a replaced one never shows while the new one loads.
  const url = loaded && loaded.sha256 === sha256 ? loaded.url : null;

  if (!project || !current) return <p className="sb-label p-3 text-text-muted">No project open.</p>;
  const imageName = current.imageId ? (mediaFields(records[current.imageId]?.props ?? {})?.sourceName ?? null) : null;
  const osDark = resolved === 'dark';

  /** One op group, worked out from the records as they are when it lands. */
  const save = (patch: ThemePatch) => {
    void projectStore.getState().applyWith((now) => setTheme(now, project.projectId, patch, { projectPath: project.file.path, osDark }));
  };

  const onFiles = (files: PictureFile[]) => {
    const [chosen] = files;
    if (!chosen || busy) return;
    // The latest pick wins; one still being read when the project switches is dropped.
    const ticket = ++reading.current;
    const openNow = projectStore.getState().project;
    setBusy(true);
    prepareThemeImage(chosen)
      .then((image) => {
        URL.revokeObjectURL(image.previewUrl);
        if (ticket !== reading.current || projectStore.getState().project !== openNow) return;
        setTyped(null);
        save({ image });
      })
      .catch(showNotice)
      .finally(() => {
        if (ticket === reading.current) setBusy(false);
      });
  };

  const shown = typed && typed.over === current.choice.accent ? typed.value : (current.choice.accent ?? '');
  // What was typed, as #RRGGBB: the picker takes no other form.
  const picked = HEX.test(shown.trim()) ? hex(parseHex(shown)) : null;
  const fitted = picked ? themeFor(picked) : null;
  const type = (value: string) => {
    setTyped({ value, over: current.choice.accent });
  };
  const applyTyped = () => {
    if (!fitted) return;
    setTyped(null);
    save({ accent: fitted.source });
  };

  return (
    // The tile takes a pasted picture anywhere in it, as its image (ThemeImageWell).
    <div data-theme-tile="" className="flex max-w-[640px] flex-col gap-5 p-4">
      <ThemeChooser
        candidates={current.candidates}
        choice={current.choice}
        busy={busy}
        onChange={(choice) => {
          setTyped(null);
          save({ accent: choice.accent, mode: choice.mode });
        }}
        image={<ThemeImageWell url={url} name={imageName} onFiles={onFiles} disabled={busy} />}
      />

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="sb-label">Accent by hand</h3>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Hex"
            mono
            value={shown}
            placeholder="#RRGGBB"
            onChange={(event) => {
              type(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyTyped();
            }}
          />
          <label htmlFor={hexId} className="flex flex-col gap-[5px]">
            <span className="sb-label">Picker</span>
            <input
              id={hexId}
              type="color"
              value={(picked ?? DEFAULT_ACCENT).toLowerCase()}
              onChange={(event) => {
                type(event.currentTarget.value);
              }}
              className="h-[34px] w-[48px] border border-text bg-surface"
            />
          </label>
          <Button disabled={!fitted} onClick={applyTyped}>
            Use this accent
          </Button>
        </div>
        {/* What was picked and what AA moved it to, in each mode. */}
        {fitted && (
          <p className="font-mono text-[12px]">
            {fitted.source} → {fitted.light.accent} light, {fitted.dark.accent} dark
          </p>
        )}
        {!picked && shown.trim() !== '' && <p className="text-[12px] text-text-muted">A colour as six hex digits, #RRGGBB, or three, #RGB.</p>}
      </section>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          disabled={!current.stored}
          onClick={() => {
            // The stored tokens are kept as approved; this works them out again from the accent with today's generator.
            save({});
          }}
        >
          Regenerate
        </Button>
        <Button
          variant="warning"
          disabled={!current.stored}
          onClick={() => {
            setTyped(null);
            void projectStore.getState().applyWith((now) => ({ changes: resetTheme(now, project.projectId) }));
          }}
        >
          Reset to default
        </Button>
      </div>
    </div>
  );
}
