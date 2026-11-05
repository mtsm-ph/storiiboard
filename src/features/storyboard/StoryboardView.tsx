import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { customValue } from '../../core/model/customFields';
import { departmentStates } from '../../core/model/departmentStatus';
import { DepartmentCounts, DepartmentStates, summaryText } from './DepartmentSummary';
import { choiceLabel, HEIGHT_LABEL, MOVE_LABEL, pageLabel, sceneLabel, SHOT_SIZE_LABEL, SUPPORT_LABEL, tStopLabel, type ShotFields } from '../../core/model/storyboard';
import type { ShotStatus } from '../../core/model/shotStatus';
import { isMac } from '../../app/shell/undoShortcuts';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { PencilButton, TitleField } from '../../ui/EditableTitle';
import { LockGlyph } from '../../ui/glyphs';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { StatusGlyph } from '../../ui/tags';
import { FrameImage, type FramePictureView } from './FrameImage';
import { verticalNeighbour } from './gridKeys';
import { NoteCard } from './NoteCard';
import { SketchSvg } from './sketch/SketchSvg';
import type { Stroke } from './sketch/strokes';
import { SlashMenu, type SlashChoice } from './SlashMenu';
import { useItemDrag, type DropPlace } from './useItemDrag';
import { labels, t, tn } from '../../core/i18n';

// The Storyboard tile (design board, Storyboard workspace) in its three views: Grid (frames by scene, wrapping),
// Strip (one row through the whole board, like a filmstrip) and Shot list (a table, one row per shot). All three are
// the same records and the same keys (CLAUDE.md, keyboard-first): the board is one Tab stop; arrows move through every
// frame and + Frame, Enter goes on to the frame's details, Delete sends it to the Trash, ⌘ with an arrow moves it.
// Pictures dropped on a frame become its picture; dropped elsewhere in a scene, new frames (1.11). Notes sit among the
// frames, frames and notes drag to a new place, and "/" opens the insert menu (1.12). This part only draws and reads
// keys and pointers; StoryboardTile does the edits and finds what a drop landed on through the data-drop-*
// attributes here.

export type BoardView = 'grid' | 'strip' | 'list';

const VIEW_LABEL: Readonly<Record<BoardView, string>> = labels({
  grid: 'board.view.grid',
  strip: 'board.view.strip',
  list: 'storyboardView.shotList',
});

export const BOARD_VIEWS: readonly { value: BoardView; label: string }[] = (['grid', 'strip', 'list'] as const).map((value) => ({
  value,
  get label() {
    return VIEW_LABEL[value];
  },
}));

export interface FrameCard {
  id: string;
  number: string;
  /** "MCU · 35MM · T2.0", empty until specs are set. */
  spec: string;
  status: ShotStatus;
  /** Every field, for the shot list's columns. */
  fields: ShotFields;
  /** Null for a frame with no picture yet. */
  picture: FramePictureView | null;
  /** The frame's sketch, drawn over its picture; empty for none. */
  strokes?: readonly Stroke[];
  /** The frame's own fields (1.19), by name. */
  custom?: Readonly<Record<string, string>>;
  /** The departments that have opened the frame (polish 6b). */
  seen?: readonly string[];
}

const NOTHING_SEEN: readonly string[] = [];

/** One thing on the board, in order: a frame or a note. */
export type BoardEntry = { kind: 'frame'; frame: FrameCard } | { kind: 'note'; id: string; text: string };

/** Where a "/" insert goes: in this scene, after this item (or at the end with null). */
export interface InsertPlace {
  sceneId: string;
  afterId: string | null;
}

/** What a drag of files is over now: a frame (its picture) or a scene (new frames). */
export type DropHover = { shotId: string } | { sceneId: string } | null;

export interface SceneGroup {
  id: string;
  number: string;
  heading: string;
  /** The scene's own name, as edited in place (the heading adds INT/EXT and the time of day round it). */
  name?: string;
  pageEighths: number | null;
  locked: boolean;
  counts: Record<ShotStatus, number>;
  frames: readonly FrameCard[];
  /** Frames and notes in board order; just the frames when left out. */
  items?: readonly BoardEntry[];
}

const entriesOf = (scene: SceneGroup): readonly BoardEntry[] =>
  scene.items ?? scene.frames.map((frame): BoardEntry => ({ kind: 'frame', frame }));
const entryId = (entry: BoardEntry) => (entry.kind === 'frame' ? entry.frame.id : entry.id);

export interface StoryboardViewProps {
  scenes: readonly SceneGroup[];
  /** Every custom field name the project's frames use (1.19): the shot list's extra columns. */
  customNames?: readonly string[];
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  /** Width over height, from the project's aspect ratio. */
  aspectRatio: number;
  selectedShotId: string | null;
  /** False with no project open. */
  canEdit: boolean;
  onSelect: (shotId: string, sceneId: string) => void;
  onAddFrame: (sceneId: string) => void;
  onAddScene: () => void;
  /** A frame or a note to the Trash. */
  onTrash: (id: string) => void;
  /** A frame or a note earlier (-1) or later (1) by one place, crossing into the next scene at either end. */
  onMove: (id: string, direction: -1 | 1) => void;
  /** A frame or a note dragged to a new place; resolves once it's saved, to whether it moved, for focus to follow. */
  onMoveTo?: (id: string, place: DropPlace) => Promise<boolean>;
  /** A note picked: its scene becomes the active one, with no frame selected. */
  onSelectScene?: (sceneId: string, noteId: string) => void;
  /** The note the keys are on, which keeps the board's Tab stop. */
  selectedNoteId?: string | null;
  /** The "/" menu's insert; resolves to the new item's id, for focus to go to it. */
  onInsert?: (choice: Exclude<SlashChoice, { kind: 'location' }>, place: InsertPlace) => Promise<string | null>;
  onSetLocation?: (sceneId: string, name: string) => void;
  onNoteText?: (noteId: string, text: string) => void;
  /** The project's locations, for the "/" menu. */
  locationNames?: readonly string[];
  /** S on a frame: its sketch, in the editor. */
  onSketch?: (shotId: string) => void;
  /** Enter on a frame: on to its details in the Frame inspector. */
  onOpen?: (shotId: string) => void;
  /** Add pictures…: the Open dialog, each picture a new frame. */
  onAddPictures?: () => void;
  /** Pictures being prepared now. */
  busy?: number;
  dropHover?: DropHover;
  /** A scene's name or a frame's title, edited in place with the pencil (Nov 5); empty for none. */
  onRenameScene?: (sceneId: string, name: string) => void;
  onRetitleShot?: (shotId: string, title: string) => void;
}

const NAV = '[data-board-item]';

/** "4 have · 1 need · 1 source", leaving out what's zero. */
export function countsLine(counts: Record<ShotStatus, number>): string {
  const parts = (['have', 'need', 'source'] as const).filter((s) => counts[s] > 0).map((s) => t(`board.counts.${s}`, { count: counts[s] }));
  return parts.join(' · ');
}

function boardItems(from: HTMLElement): HTMLElement[] {
  return [...(from.closest('[data-board]')?.querySelectorAll<HTMLElement>(NAV) ?? [])];
}

/** Where a drag of files will land: a dashed ink box over the frame, with what the drop will do. */
function DropMark({ label }: { label: string }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-1 flex items-end justify-start border-2 border-dashed border-text">
      <span className="sb-label bg-text px-1 text-text-inverse">{label}</span>
    </span>
  );
}

/** "SC 04  INT. PENN STATION — DAY  1 3/8 pg · 4 have · 1 need", plus the lock when there is one. */
function SceneHeading({ scene, className }: { scene: SceneGroup; className?: string | undefined }) {
  return (
    <span className={cx('flex flex-wrap items-baseline gap-x-3 gap-y-1', className)}>
      <span className="font-mono text-[12px] font-bold">{sceneLabel(scene.number)}</span>
      <span className="text-[13px] font-semibold">{scene.heading}</span>
      <span className="font-mono text-[11px] text-text-muted">
        {[pageLabel(scene.pageEighths), countsLine(scene.counts)].filter((p) => p !== '' && p !== '—').join(' · ')}
      </span>
      {scene.locked && (
        <span className="sb-label inline-flex items-center gap-1 text-text-muted">
          <LockGlyph /> {t('storyboardView.numbersLocked')}
        </span>
      )}
    </span>
  );
}

/**
 * A scene's heading with its pencil (Nov 5). The pencil sits after the heading, not in it, so the heading's name stays
 * "SC 04 INT. PENN STATION — DAY …" for screen readers, and is pulled into the line so the heading keeps its height.
 * While editing, the heading holds the field in the name's place.
 */
function SceneTitleRow({
  scene,
  className,
  headingClassName,
  onRename,
}: {
  scene: SceneGroup;
  className?: string;
  headingClassName?: string;
  onRename?: ((name: string) => void) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  const label = t('title.sceneName', { scene: sceneLabel(scene.number) });
  return (
    <div className={cx('group/title flex min-w-0 items-start gap-1', className)}>
      <h3 id={`scene-${scene.id}`} className={cx('min-w-0', headingClassName)}>
        {editing && onRename ? (
          <span className="flex items-baseline gap-x-3">
            <span className="font-mono text-[12px] font-bold">{sceneLabel(scene.number)}</span>
            <TitleField
              value={scene.name ?? ''}
              label={label}
              onDone={(text) => {
                setEditing(false);
                if (text !== null && text !== (scene.name ?? '')) onRename(text);
                requestAnimationFrame(() => {
                  pencil.current?.focus();
                });
              }}
            />
          </span>
        ) : (
          <SceneHeading scene={scene} className={headingClassName} />
        )}
      </h3>
      {onRename && !editing && (
        <PencilButton
          label={label}
          buttonRef={pencil}
          onClick={() => {
            setEditing(true);
          }}
          className="-my-1"
        />
      )}
    </div>
  );
}

export function StoryboardView({
  scenes,
  customNames = [],
  view,
  onViewChange,
  aspectRatio,
  selectedShotId,
  canEdit,
  onSelect,
  onAddFrame,
  onAddScene,
  onTrash,
  onMove,
  onOpen,
  onAddPictures,
  busy = 0,
  dropHover = null,
  onMoveTo,
  onSelectScene,
  selectedNoteId = null,
  onInsert,
  onSetLocation,
  onNoteText,
  locationNames = [],
  onSketch,
  onRenameScene,
  onRetitleShot,
}: StoryboardViewProps) {
  const frameCount = scenes.reduce((n, s) => n + s.frames.length, 0);
  const sceneHovered = (sceneId: string) => dropHover !== null && 'sceneId' in dropHover && dropHover.sceneId === sceneId;
  // One Tab stop: the selected frame, or the first item when nothing is selected.
  const firstEntry = scenes.flatMap((s) => entriesOf(s))[0];
  // The selected frame or note is the stop only while it's on the board; one gone to the Trash or undone away isn't.
  const onBoard = new Set(scenes.flatMap((s) => entriesOf(s).map(entryId)));
  const kept = [selectedShotId, selectedNoteId].find((id): id is string => id !== null && onBoard.has(id));
  const tabStop = kept ?? (firstEntry ? entryId(firstEntry) : null) ?? scenes[0]?.id ?? null;
  const mac = isMac();
  const [editingNote, setEditingNote] = useState<string | null>(null);
  // The frame whose title is being edited in place (its pencil, or F2 on it).
  const [titling, setTitling] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ at: { left: number; top: number }; place: InsertPlace; from: HTMLElement } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const { drag, dragHandlers } = useItemDrag(
    view === 'list',
    useCallback(
      (id: string, place: DropPlace) => {
        // Focus follows once the move is saved and drawn: into another scene, the item is drawn anew there.
        void onMoveTo?.(id, place).then((moved) => {
          if (moved) setAnnouncement(t('board.moved'));
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[data-board] [data-item-id="${CSS.escape(id)}"]`)?.focus();
          });
        });
      },
      [onMoveTo],
    ),
  );

  /** Puts focus on an item once React has drawn it. */
  const focusItem = (id: string) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-board] [data-item-id="${CSS.escape(id)}"]`)?.focus();
    });
  };

  const openSlash = (from: HTMLElement, place: InsertPlace) => {
    const box = from.getBoundingClientRect();
    setSlash({ at: { left: box.left, top: box.bottom + 4 }, place, from });
  };

  const closeSlash = () => {
    slash?.from.focus();
    setSlash(null);
  };

  const pickSlash = (choice: SlashChoice) => {
    if (!slash) return;
    const { place, from } = slash;
    setSlash(null);
    if (choice.kind === 'location') {
      onSetLocation?.(place.sceneId, choice.name);
      setAnnouncement(t('board.locationSet', { name: choice.name }));
      from.focus();
      return;
    }
    void onInsert?.(choice, place).then((id) => {
      if (!id) return;
      setAnnouncement(choice.kind === 'scene' ? t('board.sceneAdded') : choice.kind === 'note' ? t('board.noteAdded') : t('board.frameAdded'));
      if (choice.kind === 'note') setEditingNote(id);
      else if (choice.kind === 'scene') {
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`[data-scene-group="${CSS.escape(id)}"] [data-board-item]`)?.focus();
        });
      } else focusItem(id);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, itemId: string | null, kind: 'frame' | 'note' | null = 'frame') => {
    const items = boardItems(event.currentTarget);
    const current = items.indexOf(event.currentTarget);
    const command = mac ? event.metaKey : event.ctrlKey;
    const sceneId = event.currentTarget.dataset.sceneId;
    if (event.key === '/' && sceneId && onInsert && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openSlash(event.currentTarget, { sceneId, afterId: itemId });
      return;
    }
    if (itemId !== null && command && event.key.startsWith('Arrow')) {
      event.preventDefault();
      onMove(itemId, event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (itemId !== null && event.key === 'Enter') {
      event.preventDefault();
      if (kind === 'note') setEditingNote(itemId);
      else onOpen?.(itemId);
      return;
    }
    // Lowercased, so Caps Lock doesn't stop it; Shift does, leaving ⇧S free.
    const s = event.key.toLowerCase() === 's' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (itemId !== null && kind === 'frame' && onSketch && s) {
      event.preventDefault();
      onSketch(itemId);
      return;
    }
    // F2, the usual key to rename what has focus: the frame's title, in place.
    if (itemId !== null && kind === 'frame' && onRetitleShot && event.key === 'F2') {
      event.preventDefault();
      setTitling(itemId);
      return;
    }
    if (itemId !== null && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      onTrash(itemId);
      return;
    }
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = Math.min(current + 1, items.length - 1);
    else if (event.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      // In the strip every frame is in one row, so Up and Down step along it like Left and Right.
      next =
        view === 'strip'
          ? Math.min(Math.max(current + direction, 0), items.length - 1)
          : verticalNeighbour(
              items.map((item) => item.getBoundingClientRect()),
              current,
              direction,
            );
    }
    if (next === null || current === -1) return;
    event.preventDefault();
    const target = items[next];
    target?.focus();
    // Selection follows focus, so the inspector always shows the frame the keys are on.
    const id = target?.dataset.shotId;
    const targetScene = target?.dataset.sceneId;
    if (id && targetScene) onSelect(id, targetScene);
    else if (target?.dataset.noteId && targetScene) onSelectScene?.(targetScene, target.dataset.noteId);
  };

  /** The attributes every frame's focus target carries, whichever view draws it. */
  const itemProps = (frame: FrameCard, sceneId: string) => ({
    type: 'button' as const,
    'data-board-item': '',
    'data-item-id': frame.id,
    'data-shot-id': frame.id,
    'data-scene-id': sceneId,
    'aria-current': frame.id === selectedShotId ? ('true' as const) : undefined,
    tabIndex: frame.id === tabStop ? 0 : -1,
    ...dragHandlers(frame.id, frame.number),
    onClick: () => {
      onSelect(frame.id, sceneId);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown(event, frame.id);
    },
  });

  const addProps = (scene: SceneGroup) => ({
    type: 'button' as const,
    'data-board-item': '',
    // The visible "+ Frame" leads the name, so speech control can say what it sees (WCAG 2.5.3).
    'aria-label': t('board.addFrameIn', { scene: sceneLabel(scene.number) }),
    'data-scene-id': scene.id,
    tabIndex: entriesOf(scene).length === 0 && tabStop === scene.id ? 0 : -1,
    onClick: () => {
      onAddFrame(scene.id);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown(event, null);
    },
  });

  /**
   * A frame card: the picture at the aspect ratio, then the number, spec and status, and its title when it has one.
   * Grid and strip share it. The pencil sits beside the card, not in it (a button can't hold another): over its
   * top-right corner, shown on hover, on the selected frame, and as the next Tab stop after the frame with focus.
   */
  const card = (frame: FrameCard, sceneId: string, className?: string) => {
    const selected = frame.id === selectedShotId;
    const hovered = dropHover !== null && 'shotId' in dropHover && dropHover.shotId === frame.id;
    const titleLabel = t('title.shotTitle', { number: frame.number || t('history.aFrame') });
    return (
      <span className={cx('group/title relative block', className)}>
      <button
        {...itemProps(frame, sceneId)}
        {...(summaryText(frame.fields.departmentStatus, frame.seen ?? NOTHING_SEEN) !== null ? { 'aria-describedby': `departments-${frame.id}` } : {})}
        data-drop-shot={frame.id}
        className="relative flex w-full flex-col border border-border bg-surface text-left"
      >
        <span className="relative flex w-full items-center justify-center border-b border-border" style={{ aspectRatio: String(aspectRatio) }}>
          {frame.picture ? (
            <FrameImage picture={frame.picture} frameAspect={aspectRatio} />
          ) : (
            !frame.strokes?.length && (
              // Hidden from screen readers: the card is named by what follows, number, spec and status.
              <span aria-hidden="true" className="sb-label text-text-muted">
                {t('storyboardView.noImage')}
              </span>
            )
          )}
          {frame.strokes && frame.strokes.length > 0 && (
            <SketchSvg strokes={frame.strokes} aspect={aspectRatio} />
          )}
          {hovered && <DropMark label={frame.picture ? t('board.replacePicture') : t('board.setPicture')} />}
        </span>
        <span className="flex items-center gap-2 px-2 py-1.5">
          {/* The selected frame is one of the accent's few uses; the ink chip on its number is the second cue, so
              the selection reads without colour. */}
          <span data-number="" className={cx('font-mono text-[12px] font-bold', selected && 'bg-text px-1 text-text-inverse')}>
            {frame.number}
          </span>
          {/* A frame with only a sketch says so, after its number; with a picture too, the picture is its look. */}
          {!frame.picture && frame.strokes && frame.strokes.length > 0 && <span className="sr-only">{t('storyboardView.sketched')}</span>}
          <span className="truncate font-mono text-[10px] text-text-muted">{frame.spec}</span>
          <span className="ml-auto">
            <StatusGlyph status={frame.status} />
          </span>
        </span>
        {frame.fields.title !== '' && titling !== frame.id && (
          <span data-user-text="" data-frame-title="" className="-mt-1 truncate px-2 pb-1.5 text-[12px]">
            {frame.fields.title}
          </span>
        )}
        {/* How far the departments have got (polish 6b), its words the card's description. */}
        <DepartmentCounts statuses={frame.fields.departmentStatus} seen={frame.seen ?? NOTHING_SEEN} descriptionId={`departments-${frame.id}`} />
        {selected && <span aria-hidden="true" className="pointer-events-none absolute -inset-px border-[3px] border-accent" />}
      </button>
      {onRetitleShot && titling !== frame.id && (
        <PencilButton
          label={titleLabel}
          // The frame is the board's one Tab stop; its pencil is the next, so the keys reach it without the mouse.
          tabbable={frame.id === tabStop}
          reveal={selected}
          onClick={() => {
            setTitling(frame.id);
          }}
          className="absolute top-1 right-1 border border-border bg-surface"
        />
      )}
      {onRetitleShot && titling === frame.id && (
        <span className="absolute inset-x-1 bottom-1 flex">
          <TitleField
            value={frame.fields.title}
            label={titleLabel}
            className="w-full"
            onDone={(text) => {
              setTitling(null);
              if (text !== null && text !== frame.fields.title) onRetitleShot(frame.id, text);
              focusItem(frame.id);
            }}
          />
        </span>
      )}
      </span>
    );
  };

  /** A note card's focus target, as the board's keys and drag see it. */
  const noteProps = (id: string, sceneId: string) => ({
    'data-board-item': '',
    'data-item-id': id,
    'data-note-id': id,
    'data-scene-id': sceneId,
    tabIndex: id === tabStop ? 0 : -1,
    ...dragHandlers(id, t('noteCard.note')),
    onClick: () => {
      onSelectScene?.(sceneId, id);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown(event, id, 'note');
    },
  });

  const note = (entry: Extract<BoardEntry, { kind: 'note' }>, sceneId: string, className?: string) => (
    <NoteCard
      id={entry.id}
      text={entry.text}
      editing={editingNote === entry.id}
      itemProps={noteProps(entry.id, sceneId)}
      onEdit={() => {
        setEditingNote(entry.id);
      }}
      onSave={(text, back) => {
        setEditingNote(null);
        if (text !== entry.text) onNoteText?.(entry.id, text);
        if (back) focusItem(entry.id);
      }}
      onCancel={() => {
        setEditingNote(null);
        focusItem(entry.id);
      }}
      className={className}
    />
  );

  /** A frame or a note, in the grid or the strip. */
  const entry = (item: BoardEntry, sceneId: string, className?: string) =>
    item.kind === 'frame' ? card(item.frame, sceneId, className) : note(item, sceneId, cx(className, 'h-full'));

  if (!canEdit) return <p className="sb-label p-3 text-text-muted">{t('storyboardView.noProjectOpen')}</p>;

  let body: ReactNode;
  if (view === 'grid') {
    body = scenes.map((scene) => (
      <section
        key={scene.id}
        data-scene-group={scene.id}
        data-drop-scene={scene.id}
        aria-labelledby={`scene-${scene.id}`}
        className={cx('relative border-b border-border p-3', sceneHovered(scene.id) && 'outline-2 -outline-offset-4 outline-text outline-dashed')}
      >
        <SceneTitleRow
          scene={scene}
          className="mb-2.5"
          onRename={
            onRenameScene &&
            ((name: string) => {
              onRenameScene(scene.id, name);
            })
          }
        />
        <ul aria-label={t('board.framesIn', { scene: sceneLabel(scene.number) })} className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-gap">
          {entriesOf(scene).map((item) => (
            <li key={entryId(item)}>{entry(item, scene.id, 'w-full')}</li>
          ))}
          {/* As tall as the cards beside it; alone in a scene, the shape of a frame. */}
          <li className="flex">
            <button
              {...addProps(scene)}
              className="flex h-full w-full items-center justify-center border border-dashed border-text hover:bg-surface-raised"
              style={{ aspectRatio: String(aspectRatio) }}
            >
              <span className="sb-label">{t('storyboardView.frame')}</span>
            </button>
          </li>
        </ul>
      </section>
    ));
  } else if (view === 'strip') {
    // One row through the whole board. Cards keep a fixed height, so wide and tall frames line up along it.
    const width = Math.round(120 * aspectRatio);
    body = (
      <div data-scroll-root="" className="flex min-h-0 flex-1 gap-gap overflow-x-auto p-3">
        {scenes.map((scene) => (
          <section
            key={scene.id}
            data-scene-group={scene.id}
            data-drop-scene={scene.id}
            aria-labelledby={`scene-${scene.id}`}
            className={cx('flex shrink-0 flex-col gap-1.5', sceneHovered(scene.id) && 'outline-2 outline-offset-2 outline-text outline-dashed')}
          >
            <SceneTitleRow
              scene={scene}
              className="max-w-full"
              headingClassName="flex-nowrap whitespace-nowrap"
              onRename={
                onRenameScene &&
                ((name: string) => {
                  onRenameScene(scene.id, name);
                })
              }
            />
            <ul aria-label={t('board.framesIn', { scene: sceneLabel(scene.number) })} className="flex gap-gap">
              {entriesOf(scene).map((item) => (
                <li key={entryId(item)} className="shrink-0" style={{ width }}>
                  {entry(item, scene.id, 'w-full')}
                </li>
              ))}
              <li className="flex shrink-0" style={{ width: Math.round(width / 2) }}>
                <button
                  {...addProps(scene)}
                  className="flex h-full w-full items-center justify-center border border-dashed border-text hover:bg-surface-raised"
                >
                  <span className="sb-label">{t('storyboardView.frame')}</span>
                </button>
              </li>
            </ul>
          </section>
        ))}
      </div>
    );
  } else {
    body = (
      <ShotList
        scenes={scenes}
        customNames={customNames}
        selectedShotId={selectedShotId}
        itemProps={itemProps}
        addProps={addProps}
        sceneHovered={sceneHovered}
        renderNote={(item, sceneId) => note(item, sceneId, 'min-h-0')}
      />
    );
  }

  return (
    <div data-board="" className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5">
        <SegmentedControl label={t('storyboardView.view')} size="sm" options={BOARD_VIEWS} value={view} onChange={onViewChange} />
        {onAddPictures && (
          // As small as the view switch beside it, so the header keeps its height.
          <button
            type="button"
            disabled={scenes.length === 0}
            onClick={onAddPictures}
            className="sb-label h-[20px] border border-text px-2 hover:bg-surface-raised disabled:border-dashed disabled:border-text-muted disabled:text-text-muted"
          >
            {t('storyboardView.pictures')}
          </button>
        )}
        <span role="status" className="sb-label ml-auto font-mono">
          {busy > 0 ? tn('board.addingPictures', busy) : tn('count.frames', frameCount)}
        </span>
      </div>
      {scenes.length === 0 && <p className="p-3 text-[13px] text-text-muted">{t('storyboardView.noScenesYetAddA')}</p>}
      {body}
      <div className="p-3">
        <Button onClick={onAddScene}>{t('storyboardView.scene')}</Button>
      </div>
      {drag?.bar && (
        // Where the dragged item will land: an ink bar between items.
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-40 bg-text"
          style={
            drag.bar.vertical
              ? { left: drag.bar.left, top: drag.bar.top, width: 3.5, height: drag.bar.length }
              : { left: drag.bar.left, top: drag.bar.top, width: drag.bar.length, height: 3.5 }
          }
        />
      )}
      {drag && (
        // The lifted item, as the tiles lift: a dashed ghost with a hard ink offset, a second box, never a shadow.
        <div aria-hidden="true" className="pointer-events-none fixed z-50" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          <div className="absolute top-1 left-1 h-titlebar w-24 bg-text" />
          <div className="relative flex h-titlebar w-24 items-center border-[1.5px] border-dashed border-text bg-surface px-2 font-mono text-[12px] font-bold">
            {drag.label}
          </div>
        </div>
      )}
      {slash && (
        <SlashMenu
          at={slash.at}
          sceneLabel={sceneLabel(scenes.find((s) => s.id === slash.place.sceneId)?.number ?? '')}
          atEnd={slash.place.afterId === null}
          locationNames={locationNames}
          onPick={pickSlash}
          onClose={closeSlash}
        />
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

const dash = (text: string) => (text === '' ? '—' : text);
const capital = (text: string) => (text === '' ? '—' : text.charAt(0).toUpperCase() + text.slice(1));

interface ShotListProps {
  scenes: readonly SceneGroup[];
  customNames: readonly string[];
  selectedShotId: string | null;
  itemProps: (frame: FrameCard, sceneId: string) => Record<string, unknown>;
  addProps: (scene: SceneGroup) => Record<string, unknown>;
  sceneHovered: (sceneId: string) => boolean;
  renderNote: (note: Extract<BoardEntry, { kind: 'note' }>, sceneId: string) => ReactNode;
}

/**
 * The shot list: one row per shot, the way a 1st AD prints it, with a heading row for each scene. The shot number
 * is each row's focus target, so the board's keys work here too; the selected row takes the selected-row fill, with
 * the accent marker and the ink chip on its number.
 */
function ShotList({ scenes, customNames, selectedShotId, itemProps, addProps, sceneHovered, renderNote }: ShotListProps) {
  // Headers and short values stay on one line; only the action wraps.
  const head = 'sb-label px-2 py-1.5 text-left font-normal whitespace-nowrap text-text-muted';
  const cell = 'px-2 py-1.5 align-top';
  // The built-in columns, then one per custom field the project's frames use.
  const columns = 10 + customNames.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <caption className="sr-only">{t('storyboardView.shotList')}</caption>
        <thead>
          <tr className="border-b border-border">
            {(['field.shot', 'field.size', 'field.lens', 'field.tStop', 'field.support', 'field.height', 'field.move', 'field.status', 'field.action', 'field.departments'] as const).map((key) => t(key)).map((name) => (
              <th key={name} scope="col" className={head}>
                {name}
              </th>
            ))}
            {customNames.map((name) => (
              <th key={`custom:${name}`} scope="col" className={head}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        {scenes.map((scene) => (
          <tbody
            key={scene.id}
            data-scene-group={scene.id}
            data-drop-scene={scene.id}
            aria-label={t('board.framesIn', { scene: sceneLabel(scene.number) })}
            className={cx(sceneHovered(scene.id) && 'outline-2 -outline-offset-2 outline-text outline-dashed')}
          >
            <tr className="border-b border-border">
              {/* Heads the scene's rows below it, not a column. */}
              <th scope="rowgroup" colSpan={columns} className="px-2 pt-3 pb-1.5 text-left font-normal">
                <SceneHeading scene={scene} />
              </th>
            </tr>
            {entriesOf(scene).map((item) => {
              if (item.kind === 'note') {
                return (
                  <tr key={item.id} className="border-b border-border">
                    <td colSpan={columns} className={cell}>
                      {renderNote(item, scene.id)}
                    </td>
                  </tr>
                );
              }
              const frame = item.frame;
              const selected = frame.id === selectedShotId;
              const f = frame.fields;
              // Muted text never sits on the selected-row fill (DESIGN.md), so a selected row's cells go ink.
              const quiet = selected ? '' : 'text-text-muted';
              return (
                <tr key={frame.id} data-drop-shot={frame.id} className={cx('border-b border-border', selected && 'bg-surface-raised')}>
                  <td className={cx(cell, 'relative whitespace-nowrap')}>
                    {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
                    <button
                      {...itemProps(frame, scene.id)}
                      className="font-mono font-bold focus-visible:outline-offset-1"
                    >
                      <span data-number="" className={cx(selected && 'bg-text px-1 text-text-inverse')}>
                        {frame.number}
                      </span>
                    </button>
                  </td>
                  <td className={cx(cell, 'font-mono')}>{f.size ? SHOT_SIZE_LABEL[f.size] : '—'}</td>
                  <td className={cx(cell, 'font-mono')}>{f.lensMm === null ? '—' : t('history.lens', { mm: f.lensMm })}</td>
                  <td className={cx(cell, 'font-mono')}>{f.tStop === null ? '—' : tStopLabel(f.tStop)}</td>
                  <td className={cell}>{capital(choiceLabel(SUPPORT_LABEL, f.support))}</td>
                  <td className={cell}>{capital(choiceLabel(HEIGHT_LABEL, f.height))}</td>
                  <td className={cell}>{capital(choiceLabel(MOVE_LABEL, f.move))}</td>
                  <td className={cx(cell, 'whitespace-nowrap')}>
                    <StatusGlyph status={f.status} showLabel />
                  </td>
                  <td className={cx(cell, 'max-w-[28ch]', f.action === '' && quiet)}>{dash(f.action)}</td>
                  {/* Each department with anything set or seen, Priority first, with its shapes (polish 6b). */}
                  <td className={cx(cell, departmentStates(f.departmentStatus, frame.seen ?? NOTHING_SEEN).length === 0 && quiet)}>
                    <DepartmentStates statuses={f.departmentStatus} seen={frame.seen ?? NOTHING_SEEN} />
                  </td>
                  {customNames.map((name) => {
                    // The frame may spell the name in another case; it's the same field.
                    const value = customValue(frame.custom ?? {}, name);
                    return (
                      <td key={`custom:${name}`} className={cx(cell, 'max-w-[24ch]', value === '' && quiet)}>
                        {dash(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-b border-border">
              <td colSpan={columns} className={cell}>
                <button {...addProps(scene)} className="sb-label border border-dashed border-text px-2 py-1 hover:bg-surface-raised">
                  {t('storyboardView.frame')}
                </button>
              </td>
            </tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}
