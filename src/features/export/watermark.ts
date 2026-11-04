import type { StoreApi } from 'zustand/vanilla';
import type { ProjectState } from '../../app/projectStore';
import type { JsonValue, Props } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';

// The watermark (1.24, Watermark Settings in the project menu): text, where it goes, how strong, and which exports
// carry it. Stored as the project record's `watermark` prop (docs/SBD_FORMAT.md), so every export, and from Phase 9
// the web review copy, looks the same.

export const POSITIONS = ['top-left', 'top-right', 'center', 'bottom-left', 'bottom-right'] as const;
export type WatermarkPosition = (typeof POSITIONS)[number];
export const POSITION_LABEL: Readonly<Record<WatermarkPosition, string>> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  center: 'Centre',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

export const APPLIES = ['pdf', 'png', 'review'] as const;
export type WatermarkUse = (typeof APPLIES)[number];

export interface Watermark {
  text: string;
  position: WatermarkPosition;
  /** 0 to 1. */
  opacity: number;
  appliesTo: WatermarkUse[];
}

export const DEFAULT_WATERMARK: Watermark = { text: '', position: 'bottom-right', opacity: 0.35, appliesTo: ['pdf', 'png'] };

/** The project's watermark, or null when it has none (or its text is empty). */
export function readWatermark(props: Props | undefined): Watermark | null {
  const value = props?.watermark;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (text === '') return null;
  const position = POSITIONS.find((p) => p === value.position) ?? DEFAULT_WATERMARK.position;
  const opacity = typeof value.opacity === 'number' && Number.isFinite(value.opacity) ? Math.min(1, Math.max(0.05, value.opacity)) : DEFAULT_WATERMARK.opacity;
  const appliesTo = Array.isArray(value.applies_to) ? APPLIES.filter((use) => (value.applies_to as JsonValue[]).includes(use)) : DEFAULT_WATERMARK.appliesTo;
  return { text, position, opacity, appliesTo };
}

/** As stored: `applies_to` always in one order, so ticking a box off and on again stores what was there. */
export function watermarkProp(watermark: Watermark): Record<string, JsonValue> {
  return {
    text: watermark.text.trim(),
    position: watermark.position,
    opacity: watermark.opacity,
    applies_to: APPLIES.filter((use) => watermark.appliesTo.includes(use)),
  };
}

/**
 * The one edit Watermark Settings' Save makes, or null when it would change nothing the exports read, so Save on
 * settings as they were doesn't leave a step to undo that undoes nothing.
 */
export function watermarkChange(projectId: string, props: Props | undefined, draft: Watermark): Change | null {
  const stored = readWatermark(props);
  const text = draft.text.trim();
  if (text === '') return stored === null ? null : { kind: 'update', id: projectId, unset: ['watermark'] };
  const next = watermarkProp({ ...draft, text });
  if (stored !== null && JSON.stringify(watermarkProp(stored)) === JSON.stringify(next)) return null;
  return { kind: 'update', id: projectId, set: { watermark: next } };
}

/**
 * Watermark Settings' Save: writes the draft as one edit, worked out from the project as it is when the edit's turn
 * comes, and calls `close` only once it's written. A refused write leaves the dialog open with its draft, to try
 * again; the store has the reason in `error`. A second press while one is saving (a double click) is the same Save,
 * not a second step to undo. Resolves to whether it was written.
 */
export function watermarkSave(store: StoreApi<ProjectState>, projectId: string, close: () => void): (draft: Watermark) => Promise<boolean> {
  let saving: Promise<boolean> | null = null;
  return (draft) => {
    saving ??= store
      .getState()
      .applyWith((records) => {
        const change = watermarkChange(projectId, records[projectId]?.props, draft);
        return { changes: change ? [change] : [] };
      })
      .then((written) => {
        if (written) close();
        return written;
      })
      .finally(() => {
        saving = null;
      });
    return saving;
  };
}

/** The watermark an export of this kind carries, if any. */
export function watermarkFor(props: Props | undefined, use: WatermarkUse): Watermark | null {
  const watermark = readWatermark(props);
  return watermark && watermark.appliesTo.includes(use) ? watermark : null;
}
