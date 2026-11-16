import { useId, useRef } from 'react';
import { projectStore } from '../../app/projectStore';
import { useCanvasView } from '../../app/canvasView';
import { t } from '../../core/i18n';
import { Button } from '../../ui/Button';
import { canvasPalette } from '../../ui/canvas/canvasPalette';
import { cx } from '../../ui/cx';
import { changeBorder, changeCropEdge, resetCrop } from './boardActions';
import { ColourControl } from './ColourControl';
import { BORDER_WIDTH_MAX, BORDER_WIDTH_MIN, cleanBorderWidth, cropEdgeChanges, cropEdgesOf, type CropEdges, type ItemFields } from './items';

// A picture's crop and border in the properties strip (6.5.7b): the keyboard's way to crop (four fields, what is cut off
// each side in percent, and Reset crop), and the border's switch, colour and width. Each change is one op group. Only
// the one field whose number changed is drawn anew (its key is its value, as the strip's font size is), so focus stays
// where the person put it, Tab after a typed side included (round 2).

const FIELD = 'h-8 border border-text bg-surface-raised px-2 font-mono text-[13px] text-text';
const EDGES: readonly { edge: keyof CropEdges; label: () => string }[] = [
  { edge: 'left', label: () => t('moodboard.crop.left') },
  { edge: 'top', label: () => t('moodboard.crop.top') },
  { edge: 'right', label: () => t('moodboard.crop.right') },
  { edge: 'bottom', label: () => t('moodboard.crop.bottom') },
];

/** The crop's four fields under a "Crop" heading, and Reset crop. A number that can't be taken goes back. */
export function CropFields({ id, fields }: { id: string; fields: ItemFields }) {
  const edges = cropEdgesOf(fields.crop);
  const heading = useId();
  const group = useRef<HTMLDivElement>(null);
  return (
    <div ref={group} role="group" aria-labelledby={heading} data-picture-crop="" className="flex flex-col gap-[5px]">
      <span id={heading} className="sb-label">
        {t('moodboard.crop.label')}
      </span>
      <div className="flex items-center gap-2">
        {EDGES.map(({ edge, label }) => (
          <label key={edge} className="flex items-center gap-1">
            <span className="sb-label whitespace-nowrap">
              {/* Heard as "Crop Left %", seen as "Left %" under the heading. */}
              <span className="sr-only">{t('moodboard.crop.label')} </span>
              {label()}
            </span>
            <input
              key={String(edges[edge])}
              type="number"
              min={0}
              max={100}
              step={1}
              data-crop-edge={edge}
              defaultValue={edges[edge]}
              onBlur={(event) => {
                const input = event.currentTarget;
                const value = Number(input.value);
                if (input.value.trim() === '' || !Number.isFinite(value)) {
                  input.value = String(edges[edge]);
                  return;
                }
                if (value === edges[edge]) return;
                // Refused (outside 0 to 100, too little left): the field shows the crop as it is.
                if (cropEdgeChanges(projectStore.getState().records, id, edge, value).length === 0) {
                  input.value = String(edges[edge]);
                  return;
                }
                void changeCropEdge(id, edge, value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className={cx(FIELD, 'w-16')}
            />
          </label>
        ))}
        <Button
          data-reset-crop=""
          disabled={fields.crop === null}
          onClick={() => {
            // The button is disabled once the crop is gone: focus goes to the first crop field, not the page.
            void resetCrop(id).then(() => {
              requestAnimationFrame(() => group.current?.querySelector<HTMLInputElement>('[data-crop-edge="left"]')?.focus());
            });
          }}
        >
          {t('moodboard.crop.reset')}
        </Button>
      </div>
    </div>
  );
}

const STEP_BUTTON = 'sb-label flex h-8 w-7 items-center justify-center border border-text text-text hover:bg-surface-raised focus-visible:-outline-offset-4 disabled:text-text-muted disabled:hover:bg-transparent';

/** The border under a "Border" heading: shown or not, its colour (Default: the board's ink), and its width with a stepper. */
export function BorderFields({ id, fields }: { id: string; fields: ItemFields }) {
  const width = fields.borderWidth;
  const heading = useId();
  // The default's swatch is what a border with no colour of its own is drawn in, in this view (round 2).
  const view = useCanvasView('board');
  const drawnInk = canvasPalette(view).ink;
  return (
    <div role="group" aria-labelledby={heading} data-picture-border={fields.border ? 'on' : 'off'} className="flex items-end gap-2">
      <div className="flex flex-col gap-[5px]">
        <span id={heading} className="sb-label">
          {t('moodboard.border.label')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={fields.border}
          aria-label={t('moodboard.border.switch')}
          data-border-switch=""
          onClick={() => {
            void changeBorder(id, { border: !fields.border });
          }}
          className={cx('sb-label flex h-8 items-center border border-text px-2.5 focus-visible:-outline-offset-4', fields.border ? 'bg-text font-bold text-text-inverse focus-visible:outline-text-inverse' : 'text-text hover:bg-surface-raised')}
        >
          {t('moodboard.border.show')}
        </button>
      </div>
      <ColourControl
        label={t('moodboard.border.colour')}
        value={fields.borderColor}
        unset={drawnInk}
        onChange={(color) => {
          void changeBorder(id, { color });
        }}
        onDefault={() => {
          void changeBorder(id, { color: null });
        }}
      />
      <div className="flex flex-col gap-[5px]">
        <label htmlFor={`${heading}-width`} className="sb-label">
          {t('moodboard.border.width')}
        </label>
        <div className="flex items-center gap-1">
          <input
            key={String(width)}
            id={`${heading}-width`}
            type="number"
            min={BORDER_WIDTH_MIN}
            max={BORDER_WIDTH_MAX}
            step={1}
            data-border-width=""
            defaultValue={width}
            onBlur={(event) => {
              const input = event.currentTarget;
              const value = Number(input.value);
              if (input.value.trim() === '' || !Number.isFinite(value)) {
                input.value = String(width);
                return;
              }
              // Always what is stored (round 2): 0 shows 1 again, 41 shows 40, even when that is the width already.
              const kept = cleanBorderWidth(Math.round(value * 100) / 100);
              input.value = String(kept);
              if (kept !== width) void changeBorder(id, { width: kept });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            className={cx(FIELD, 'w-16')}
          />
          <div className="flex [&>button+button]:-ml-px">
            <button type="button" aria-label={t('moodboard.border.thinner')} disabled={width <= BORDER_WIDTH_MIN} onClick={() => { void changeBorder(id, { width: width - 1 }); }} className={STEP_BUTTON}>
              −
            </button>
            <button type="button" aria-label={t('moodboard.border.thicker')} disabled={width >= BORDER_WIDTH_MAX} onClick={() => { void changeBorder(id, { width: width + 1 }); }} className={STEP_BUTTON}>
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
