import type { KeyboardEvent } from 'react';
import { pageLabel, sceneLabel, type SceneFields } from '../../core/model/storyboard';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { LockGlyph } from '../../ui/glyphs';

// The Scenes tile (design board, Storyboard workspace): every scene in board order with its length, how many frames
// it has, and how much of it is in hand; then the film's coverage and + New scene. This part only draws.

export interface SceneRow {
  id: string;
  fields: SceneFields;
  frames: number;
  /** Frames whose picture is in hand, 0–100; null with no frames. */
  coverage: number | null;
}

export interface ScenesViewProps {
  scenes: readonly SceneRow[];
  activeSceneId: string | null;
  /** The whole board's coverage, null with no frames. */
  coverage: number | null;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onAdd: () => void;
}

/** "INT. PENN STATION — DAY", as a scene heading reads; just the name until INT/EXT or DAY/NIGHT is set. */
export function headingOf(fields: SceneFields): string {
  const name = fields.name || 'Untitled';
  if (!fields.intExt && !fields.dayNight) return name;
  return [fields.intExt ? `${fields.intExt}.` : null, name.toUpperCase(), fields.dayNight ? `— ${fields.dayNight}` : null]
    .filter((part) => part !== null)
    .join(' ');
}

/** "1 3/8 pg · 6 fr · 67%", or "done" once every frame is in hand. */
export function sceneSummary(row: SceneRow): string {
  const parts = [pageLabel(row.fields.pageEighths), `${String(row.frames)} fr`];
  if (row.coverage !== null) parts.push(row.coverage === 100 ? 'done' : `${String(row.coverage)}%`);
  return parts.join(' · ');
}

/** Up and Down (and Home, End) move between scenes, as through a list. */
function onRowKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
  const rows = [...(event.currentTarget.closest('ul')?.querySelectorAll<HTMLElement>('[data-scene-row]') ?? [])];
  const current = rows.indexOf(event.currentTarget);
  const last = rows.length - 1;
  const next = { ArrowDown: Math.min(current + 1, last), ArrowUp: Math.max(current - 1, 0), Home: 0, End: last }[event.key];
  if (next === undefined || current === -1) return;
  event.preventDefault();
  rows[next]?.focus();
}

export function ScenesView({ scenes, activeSceneId, coverage, canAdd, onSelect, onToggleLock, onAdd }: ScenesViewProps) {
  const totalEighths = scenes.reduce<number | null>(
    (sum, s) => (s.fields.pageEighths === null ? sum : (sum ?? 0) + s.fields.pageEighths),
    null,
  );
  return (
    <div className="flex min-h-full flex-col">
      <p className="sb-label flex gap-3 border-b border-border px-3 py-2">
        <span className="font-mono">{String(scenes.length).padStart(2, '0')}</span>
        <span className="text-text-muted">Board order</span>
        <span className="ml-auto font-mono">{pageLabel(totalEighths)}</span>
      </p>
      {scenes.length === 0 ? (
        <p className="p-3 text-[13px] text-text-muted">
          {canAdd ? 'No scenes yet. Add one, or import a script (later in Phase 1).' : 'No project open.'}
        </p>
      ) : (
        <ul aria-label="Scenes" className="flex-1">
          {scenes.map((row) => {
            const active = row.id === activeSceneId;
            const label = sceneLabel(row.fields.number);
            return (
              <li key={row.id} className="flex items-stretch border-b border-border">
                <button
                  type="button"
                  data-scene-row=""
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    onSelect(row.id);
                  }}
                  onKeyDown={onRowKeyDown}
                  className="group flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-raised focus-visible:-outline-offset-4"
                >
                  {/* The active scene's marker is orange; its bold heading is the second cue. */}
                  <span aria-hidden="true" className={cx('mt-1.5 size-1.5 shrink-0', active ? 'bg-accent' : 'border border-text')} />
                  <span className="font-mono text-[12px] font-bold">{label.replace('SC ', '')}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className={cx('truncate text-[13px]', active && 'font-bold')}>{headingOf(row.fields)}</span>
                    {/* Muted until hovered: muted text never sits on oatmeal. */}
                    <span className="font-mono text-[11px] text-text-muted group-hover:text-text">{sceneSummary(row)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={row.fields.numbersLocked}
                  aria-label={`Lock shot numbers for ${label}`}
                  title={row.fields.numbersLocked ? 'Shot numbers locked' : 'Lock shot numbers'}
                  onClick={() => {
                    onToggleLock(row.id, !row.fields.numbersLocked);
                  }}
                  // The open and closed padlock carry the state; no fading, which would drop the icon below 3:1.
                  className="flex w-8 shrink-0 items-center justify-center hover:bg-surface-raised focus-visible:-outline-offset-4"
                >
                  <LockGlyph open={!row.fields.numbersLocked} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto flex flex-col gap-2 border-t border-border p-3">
        <p className="sb-label flex">
          Film coverage
          <span className="ml-auto font-mono">{coverage === null ? '—' : `${String(coverage)}%`}</span>
        </p>
        <Button disabled={!canAdd} onClick={onAdd} className="self-start">
          + New scene
        </Button>
      </div>
    </div>
  );
}
