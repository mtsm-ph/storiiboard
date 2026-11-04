import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../ui/cx';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { cssVariables, DEFAULT_ACCENT, themeFor, type ModeTokens } from '../../ui/theme/generator/generate';
import type { ResolvedTheme } from '../../ui/theme/theme';

// Choosing a project's look (1.16, docs/PLAN.md B): the logo or key image, the accents it offers, light or dark, and
// a live preview of the app in both modes. Shared by onboarding and Settings → Theme; this part only draws.

export interface ThemeChoice {
  /** The accent picked, before the AA fit; null keeps the kit's orange. */
  accent: string | null;
  mode: ResolvedTheme;
}

interface ThemeChooserProps {
  /** What the image offers, most saturated first; empty before an image, or for a grey one. */
  candidates: readonly string[];
  choice: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
  /** The image well: its picture or what to do, from the caller, which takes drops and pastes there. */
  image: ReactNode;
  /** Reading the image's colours. */
  busy?: boolean;
}

/** A small app in a theme's colours: top bar, sidebar with its active section, and a tile with a selected frame. */
function Preview({ tokens, label }: { tokens: ModeTokens; label: string }) {
  return (
    <figure className="flex flex-col gap-1">
      {/* The tokens on this box alone: every class inside reads them, the rest of the app is untouched. */}
      <div aria-hidden="true" className="flex h-[112px] w-[168px] flex-col border border-border-top bg-bg" style={cssVariables(tokens)}>
        <div className="h-[12px] border-b border-border-top" />
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[44px] flex-col gap-1 border-r border-border-top p-1">
            <span className="block h-[8px] bg-accent" />
            <span className="block h-[3px] w-[24px] bg-text-muted" />
            <span className="block h-[3px] w-[30px] bg-text-muted" />
          </div>
          <div className="m-1 flex flex-1 flex-col gap-1 border border-border bg-surface p-1">
            <span className="block h-[3px] w-[40px] bg-text" />
            <div className="flex gap-1">
              <span className="block h-[30px] flex-1 border-2 border-accent bg-surface-raised" />
              <span className="block h-[30px] flex-1 border border-border bg-surface-raised" />
            </div>
            <span className="mt-auto block h-[10px] w-[34px] border border-text bg-accent" />
          </div>
        </div>
      </div>
      <figcaption className="sb-label text-text-muted">{label}</figcaption>
    </figure>
  );
}

export function ThemeChooser({ candidates, choice, onChange, image, busy = false }: ThemeChooserProps) {
  const groupId = useId();
  const theme = themeFor(choice.accent);
  // The kit's orange is always there to go back to.
  const options: (string | null)[] = [null, ...candidates.filter((c) => c.toUpperCase() !== DEFAULT_ACCENT)];
  const current = options.findIndex((o) => (o ?? DEFAULT_ACCENT).toUpperCase() === (choice.accent ?? DEFAULT_ACCENT).toUpperCase());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange({ ...choice, accent: options[next] ?? null });
    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-4">
      {image}
      <div className="flex flex-col gap-[5px]">
        <span id={groupId} className="sb-label">
          Accent
        </span>
        <div role="radiogroup" aria-labelledby={groupId} aria-busy={busy} className="flex flex-wrap gap-2">
          {options.map((option, index) => {
            const selected = index === (current === -1 ? 0 : current);
            const hex = option ?? DEFAULT_ACCENT;
            return (
              <button
                key={hex}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  onChange({ ...choice, accent: option });
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, index);
                }}
                className={cx('flex items-center gap-2 border px-2 py-1', selected ? 'border-text bg-text text-text-inverse' : 'border-text')}
              >
                {/* The swatch is the colour; the hex beside it is the second cue, and the name for readers. */}
                <span aria-hidden="true" className="block h-[16px] w-[16px] border border-text" style={{ backgroundColor: hex }} />
                <span className="font-mono text-[12px]">{option ? hex : `${hex} kit`}</span>
              </button>
            );
          })}
        </div>
        {busy && <p className="text-[12px] text-text-muted">Reading the image’s colours…</p>}
        {!busy && candidates.length === 0 && (
          <p className="text-[12px] text-text-muted">Add a logo or key image for accents from it; the kit’s orange works on its own.</p>
        )}
      </div>
      <SegmentedControl
        label="Mode"
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={choice.mode}
        onChange={(mode) => {
          onChange({ ...choice, mode });
        }}
      />
      <div className="flex flex-wrap gap-4">
        <Preview tokens={theme.light} label="Light" />
        <Preview tokens={theme.dark} label="Dark" />
      </div>
    </div>
  );
}
