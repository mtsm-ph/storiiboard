import type { KeyboardEvent } from 'react';
import { pageLabel, sceneLabel } from '../../core/model/storyboard';
import type { ShotStatus } from '../../core/model/shotStatus';
import { isMac } from '../../app/shell/undoShortcuts';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { LockGlyph } from '../../ui/glyphs';
import { StatusGlyph } from '../../ui/tags';
import { verticalNeighbour } from './gridKeys';

// The Storyboard tile (design board, Storyboard workspace): frames grouped by scene, each card at the project's aspect
// ratio with its shot number, its spec in mono and its status shape. Keyboard-first (CLAUDE.md): the board is one Tab
// stop; arrows move through every frame and + Frame card, Enter goes on to the frame's details, Delete sends it to
// the Trash, ⌘ with an arrow moves it. This part only draws and reads keys; StoryboardTile does the edits.

export interface FrameCard {
  id: string;
  number: string;
  /** "MCU · 35MM · T2.0", empty until specs are set. */
  spec: string;
  status: ShotStatus;
}

export interface SceneGroup {
  id: string;
  number: string;
  heading: string;
  pageEighths: number | null;
  locked: boolean;
  counts: Record<ShotStatus, number>;
  frames: readonly FrameCard[];
}

export interface StoryboardViewProps {
  scenes: readonly SceneGroup[];
  /** Width over height, from the project's aspect ratio. */
  aspectRatio: number;
  selectedShotId: string | null;
  /** False with no project open. */
  canEdit: boolean;
  onSelect: (shotId: string, sceneId: string) => void;
  onAddFrame: (sceneId: string) => void;
  onAddScene: () => void;
  onTrash: (shotId: string) => void;
  /** Earlier (-1) or later (1) by one place, crossing into the next scene at either end. */
  onMove: (shotId: string, direction: -1 | 1) => void;
  /** Enter on a frame: on to its details in the Frame inspector. */
  onOpen?: (shotId: string) => void;
}

const NAV = '[data-board-item]';

/** "4 have · 1 need · 1 source", leaving out what's zero. */
export function countsLine(counts: Record<ShotStatus, number>): string {
  const parts = (['have', 'need', 'source'] as const).filter((s) => counts[s] > 0).map((s) => `${String(counts[s])} ${s}`);
  return parts.join(' · ');
}

function boardItems(from: HTMLElement): HTMLElement[] {
  return [...(from.closest('[data-board]')?.querySelectorAll<HTMLElement>(NAV) ?? [])];
}

export function StoryboardView({
  scenes,
  aspectRatio,
  selectedShotId,
  canEdit,
  onSelect,
  onAddFrame,
  onAddScene,
  onTrash,
  onMove,
  onOpen,
}: StoryboardViewProps) {
  const frameCount = scenes.reduce((n, s) => n + s.frames.length, 0);
  // One Tab stop: the selected frame, or the first item when nothing is selected.
  const tabStop = selectedShotId ?? scenes.flatMap((s) => s.frames)[0]?.id ?? scenes[0]?.id ?? null;
  const mac = isMac();

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, shotId: string | null) => {
    const items = boardItems(event.currentTarget);
    const current = items.indexOf(event.currentTarget);
    const command = mac ? event.metaKey : event.ctrlKey;
    if (shotId !== null && command && event.key.startsWith('Arrow')) {
      event.preventDefault();
      onMove(shotId, event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (shotId !== null && event.key === 'Enter' && onOpen) {
      event.preventDefault();
      onOpen(shotId);
      return;
    }
    if (shotId !== null && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      onTrash(shotId);
      return;
    }
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = Math.min(current + 1, items.length - 1);
    else if (event.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const boxes = items.map((item) => item.getBoundingClientRect());
      next = verticalNeighbour(boxes, current, event.key === 'ArrowDown' ? 1 : -1);
    }
    if (next === null || current === -1) return;
    event.preventDefault();
    const target = items[next];
    target?.focus();
    // Selection follows focus, so the inspector always shows the frame the keys are on.
    const id = target?.dataset.shotId;
    const sceneId = target?.dataset.sceneId;
    if (id && sceneId) onSelect(id, sceneId);
  };

  if (!canEdit) return <p className="sb-label p-3 text-text-muted">No project open.</p>;

  return (
    <div data-board="" className="flex min-h-full flex-col">
      <p className="sb-label flex gap-3 border-b border-border px-3 py-2">
        <span>Grid</span>
        <span className="ml-auto font-mono">
          {frameCount} {frameCount === 1 ? 'frame' : 'frames'}
        </span>
      </p>
      {scenes.length === 0 && (
        <p className="p-3 text-[13px] text-text-muted">No scenes yet. Add a scene, then its frames.</p>
      )}
      {scenes.map((scene) => (
        <section key={scene.id} data-scene-group={scene.id} aria-labelledby={`scene-${scene.id}`} className="border-b border-border p-3">
          <h3 id={`scene-${scene.id}`} className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[12px] font-bold">{sceneLabel(scene.number)}</span>
            <span className="text-[13px] font-semibold">{scene.heading}</span>
            <span className="font-mono text-[11px] text-text-muted">
              {[pageLabel(scene.pageEighths), countsLine(scene.counts)].filter((p) => p !== '' && p !== '—').join(' · ')}
            </span>
            {scene.locked && (
              <span className="sb-label inline-flex items-center gap-1 text-text-muted">
                <LockGlyph /> Numbers locked
              </span>
            )}
          </h3>
          <ul aria-label={`Frames in ${sceneLabel(scene.number)}`} className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-gap">
            {scene.frames.map((frame) => {
              const selected = frame.id === selectedShotId;
              return (
                <li key={frame.id}>
                  <button
                    type="button"
                    data-board-item=""
                    data-shot-id={frame.id}
                    data-scene-id={scene.id}
                    aria-current={selected ? 'true' : undefined}
                    tabIndex={frame.id === tabStop ? 0 : -1}
                    onClick={() => {
                      onSelect(frame.id, scene.id);
                    }}
                    onKeyDown={(event) => {
                      onKeyDown(event, frame.id);
                    }}
                    className="relative flex w-full flex-col border border-border bg-surface text-left"
                  >
                    <span
                      className="flex w-full items-center justify-center border-b border-border"
                      style={{ aspectRatio: String(aspectRatio) }}
                    >
                      {/* Hidden from screen readers: the card is named by what follows, number, spec and status. */}
                      <span aria-hidden="true" className="sb-label text-text-muted">
                        No image
                      </span>
                    </span>
                    <span className="flex items-center gap-2 px-2 py-1.5">
                      {/* The selected frame is one of the accent's few uses; the ink chip on its number is the
                          second cue, so the selection reads without colour. */}
                      <span
                        data-number=""
                        className={cx('font-mono text-[12px] font-bold', selected && 'bg-text px-1 text-text-inverse')}
                      >
                        {frame.number}
                      </span>
                      <span className="truncate font-mono text-[10px] text-text-muted">{frame.spec}</span>
                      <span className="ml-auto">
                        <StatusGlyph status={frame.status} />
                      </span>
                    </span>
                    {selected && <span aria-hidden="true" className="pointer-events-none absolute -inset-px border-[3px] border-accent" />}
                  </button>
                </li>
              );
            })}
            {/* As tall as the cards beside it; alone in a scene, the shape of a frame. */}
            <li className="flex">
              <button
                type="button"
                data-board-item=""
                // The visible "+ Frame" leads the name, so speech control can say what it sees (WCAG 2.5.3).
                aria-label={`+ Frame in ${sceneLabel(scene.number)}`}
                tabIndex={scene.frames.length === 0 && tabStop === scene.id ? 0 : -1}
                onClick={() => {
                  onAddFrame(scene.id);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, null);
                }}
                className="flex h-full w-full items-center justify-center border border-dashed border-text hover:bg-surface-raised"
                style={{ aspectRatio: String(aspectRatio) }}
              >
                <span className="sb-label">+ Frame</span>
              </button>
            </li>
          </ul>
        </section>
      ))}
      <div className="p-3">
        <Button onClick={onAddScene}>+ Scene</Button>
      </div>
    </div>
  );
}
