import { useMemo, type ReactNode } from 'react';
import { t } from '../../core/i18n';
import { cx } from '../../ui/cx';
import { Select } from '../../ui/fields';
import { ColourControl } from './ColourControl';
import { DEFAULT_PAGE_BACKGROUND } from './pageFormats';
import { availability, familiesOf, useFonts, type FontFamilyEntry } from './fonts';
import type { AlignMode, CanvasCommand, TidyMode } from '../../ui/canvas/types';
import { ALIGNS, BOARD_INK, BOARD_RAISED, hasTextStyle, isShapeKind, SECTION_COLOURS, sectionColourName, STICKY_COLOURS, stickyColourName, type Align, type ItemFields, type StylePatch } from './items';

// What the selected items share, under the tools (5.1a): fill and stroke for shapes, colour for text, the sticky colours,
// and font family, style, size and alignment for text boxes and sticky notes. A change applies to every selected item it
// fits, in one op group. Where the items differ the first one's value shows.

const WEIGHT_NAMES: Readonly<Record<number, () => string>> = {
  100: () => t('moodboard.weight.100'),
  200: () => t('moodboard.weight.200'),
  300: () => t('moodboard.weight.300'),
  400: () => t('moodboard.weight.400'),
  500: () => t('moodboard.weight.500'),
  600: () => t('moodboard.weight.600'),
  700: () => t('moodboard.weight.700'),
  800: () => t('moodboard.weight.800'),
  900: () => t('moodboard.weight.900'),
};

/** A style as a person names it: Regular, Bold, Italic, Bold Italic. */
export function styleName(weight: number, italic: boolean): string {
  const name = WEIGHT_NAMES[weight]?.() ?? String(weight);
  if (!italic) return name;
  return weight === 400 ? t('moodboard.italic') : t('moodboard.weightItalic', { weight: name });
}

const ALIGN_LABEL: Readonly<Record<Align, () => string>> = {
  left: () => t('moodboard.align.left'),
  center: () => t('moodboard.align.center'),
  right: () => t('moodboard.align.right'),
};

const styleKey = (weight: number, italic: boolean) => `${String(weight)}${italic ? 'i' : ''}`;

/** The styles a family offers, each once, lightest first, upright before italic. */
function stylesOf(family: FontFamilyEntry | undefined, current: { weight: number; italic: boolean }): { weight: number; italic: boolean }[] {
  const seen = new Map<string, { weight: number; italic: boolean }>();
  for (const style of family?.styles ?? []) seen.set(styleKey(style.weight, style.italic), { weight: style.weight, italic: style.italic });
  // The style a board has is always in the list, even where the family lacks it.
  seen.set(styleKey(current.weight, current.italic), { weight: current.weight, italic: current.italic });
  return [...seen.values()].sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
}

/** Whether every item has the same value; where they differ the strip shows a mixed state, not the first item's. */
const same = <T,>(items: readonly T[], get: (item: T) => unknown): boolean => items.every((item) => get(item) === get(items[0] as T));

/** One fixed height, one row: more controls than fit scroll sideways rather than wrap. */
const BAND = 'flex h-[72px] shrink-0 flex-nowrap items-end gap-3 overflow-x-auto overflow-y-hidden [scrollbar-width:thin] border-b border-border px-2 py-2 [&>*]:shrink-0';

interface PropertiesStripProps {
  fields: readonly ItemFields[];
  /** Changes when the selection does, so the size field starts again from the new selection's value. */
  selectionKey: string;
  onChange: (patch: StylePatch) => void;
  /** What a picture, video card or link adds (CardProperties). */
  children?: ReactNode;
  /** Align, distribute and tidy the selected items (5.3); the Arrange group shows with two or more. */
  onArrange?: (command: CanvasCommand) => void;
}

const ALIGN_BUTTONS: readonly { mode: AlignMode; label: () => string; name: () => string }[] = [
  { mode: 'left', label: () => t('canvas.align.short.left'), name: () => t('canvas.align.left') },
  { mode: 'center', label: () => t('canvas.align.short.center'), name: () => t('canvas.align.center') },
  { mode: 'right', label: () => t('canvas.align.short.right'), name: () => t('canvas.align.right') },
  { mode: 'top', label: () => t('canvas.align.short.top'), name: () => t('canvas.align.top') },
  { mode: 'middle', label: () => t('canvas.align.short.middle'), name: () => t('canvas.align.middle') },
  { mode: 'bottom', label: () => t('canvas.align.short.bottom'), name: () => t('canvas.align.bottom') },
];

const TIDY_BUTTONS: readonly { mode: TidyMode; label: () => string; name: () => string }[] = [
  { mode: 'row', label: () => t('canvas.tidy.short.row'), name: () => t('canvas.tidy.row') },
  { mode: 'column', label: () => t('canvas.tidy.short.column'), name: () => t('canvas.tidy.column') },
  { mode: 'grid', label: () => t('canvas.tidy.short.grid'), name: () => t('canvas.tidy.grid') },
];

const ARRANGE_BUTTON = 'sb-label flex h-8 items-center border border-text px-2.5 text-text hover:bg-surface-raised focus-visible:-outline-offset-4 disabled:text-text-muted disabled:hover:bg-transparent';

/** A labelled run of joined buttons in the Arrange group. */
function Run({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <span className="sb-label">{label}</span>
      <div className="flex [&>button+button]:-ml-px">{children}</div>
    </div>
  );
}

/** Layout of two or more selected items (5.3): align to their bounds, distribute with equal gaps, tidy into a row, column or grid. */
function Arrange({ count, onArrange }: { count: number; onArrange: (command: CanvasCommand) => void }) {
  return (
    <div role="group" aria-label={t('canvas.arrange')} className="flex items-end gap-3">
      <Run label={t('canvas.arrange.align')}>
        {ALIGN_BUTTONS.map(({ mode, label, name }) => (
          <button key={mode} type="button" aria-label={name()} onClick={() => { onArrange({ kind: 'align', mode }); }} className={ARRANGE_BUTTON}>
            {label()}
          </button>
        ))}
      </Run>
      <Run label={t('canvas.arrange.distribute')}>
        <button type="button" aria-label={t('canvas.distribute.across')} disabled={count < 3} onClick={() => { onArrange({ kind: 'distribute', axis: 'horizontal' }); }} className={ARRANGE_BUTTON}>
          {t('canvas.distribute.short.horizontal')}
        </button>
        <button type="button" aria-label={t('canvas.distribute.down')} disabled={count < 3} onClick={() => { onArrange({ kind: 'distribute', axis: 'vertical' }); }} className={ARRANGE_BUTTON}>
          {t('canvas.distribute.short.vertical')}
        </button>
      </Run>
      <Run label={t('canvas.arrange.tidy')}>
        {TIDY_BUTTONS.map(({ mode, label, name }) => (
          <button key={mode} type="button" aria-label={name()} onClick={() => { onArrange({ kind: 'tidy', mode }); }} className={ARRANGE_BUTTON}>
            {label()}
          </button>
        ))}
      </Run>
    </div>
  );
}

export function PropertiesStrip({ fields, selectionKey, onChange, children, onArrange }: PropertiesStripProps) {
  const system = useFonts((s) => s.system);
  const status = useFonts((s) => s.status);
  const shapes = fields.filter((f) => isShapeKind(f.kind));
  const texts = fields.filter((f) => f.kind === 'text' || f.kind === 'field_card');
  const pages = fields.filter((f) => f.kind === 'page');
  const stickies = fields.filter((f) => f.kind === 'sticky');
  const sections = fields.filter((f) => f.kind === 'section');
  const lettered = fields.filter((f) => hasTextStyle(f.kind));
  const first = lettered[0];
  const families = useMemo(() => familiesOf(system), [system]);
  // The band is always there at one height, empty with nothing selected, so the canvas below never changes size.
  if (fields.length === 0 && !children) return <div className={BAND} />;

  const missing = first && availability(first.fontFamily, { status, system }) === 'missing';
  const entry = first ? families.find((f) => f.name === first.fontFamily) : undefined;
  const styles = first ? stylesOf(entry, { weight: first.fontWeight, italic: first.fontItalic }) : [];
  const mixedFamily = !same(lettered, (f) => f.fontFamily);
  const mixedStyle = !same(lettered, (f) => styleKey(f.fontWeight, f.fontItalic));
  const mixedSize = !same(lettered, (f) => f.fontSize);
  const mixedAlign = !same(lettered, (f) => f.align);

  return (
    <div role="group" aria-label={t('moodboard.properties')} data-board-properties="" className={BAND}>
      {children}
      {shapes[0] && (
        <>
          <ColourControl label={t('moodboard.fill')} value={shapes[0].fill} mixed={!same(shapes, (f) => f.fill)} unset={BOARD_RAISED} onChange={(fill) => { onChange({ fill }); }} />
          <ColourControl label={t('moodboard.stroke')} value={shapes[0].stroke} mixed={!same(shapes, (f) => f.stroke)} unset={BOARD_INK} onChange={(stroke) => { onChange({ stroke }); }} />
        </>
      )}
      {texts[0] && <ColourControl label={t('moodboard.textColour')} value={texts[0].color} mixed={!same(texts, (f) => f.color)} unset={BOARD_INK} onChange={(textColor) => { onChange({ textColor }); }} />}
      {stickies[0] && (
        <ColourControl
          label={t('moodboard.stickyColour')}
          value={stickies[0].color ?? STICKY_COLOURS[0]}
          unset={STICKY_COLOURS[0]}
          mixed={!same(stickies, (f) => f.color)}
          swatches={STICKY_COLOURS}
          nameOf={stickyColourName}
          custom={false}
          onChange={(stickyColor) => { onChange({ stickyColor }); }}
        />
      )}
      {pages[0] && (
        <ColourControl label={t('deck.pageBackground')} value={pages[0].background} unset={DEFAULT_PAGE_BACKGROUND} mixed={!same(pages, (f) => f.background)} onChange={(pageBackground) => { onChange({ pageBackground }); }} />
      )}
      {sections[0] && (
        <ColourControl
          label={t('moodboard.sectionColour')}
          value={sections[0].color ?? SECTION_COLOURS[0]}
          unset={SECTION_COLOURS[0]}
          mixed={!same(sections, (f) => f.color)}
          swatches={SECTION_COLOURS}
          nameOf={sectionColourName}
          custom={false}
          onChange={(sectionColor) => { onChange({ sectionColor }); }}
        />
      )}
      {first && (
        <>
          <div className="w-44">
            <Select
              label={t('moodboard.font')}
              value={mixedFamily ? '' : first.fontFamily}
              onChange={(event) => {
                if (event.target.value !== '') onChange({ fontFamily: event.target.value });
              }}
            >
              {mixedFamily && <option value="">{t('moodboard.mixed')}</option>}
              {missing && <option value={first.fontFamily}>{t('moodboard.fontMissingOption', { name: first.fontFamily })}</option>}
              <optgroup label={t('moodboard.fontsBundled')}>
                {families.filter((f) => f.bundled).map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
              {system.length > 0 && (
                <optgroup label={t('moodboard.fontsThisComputer')}>
                  {system.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
          <div className="w-36">
            <Select
              label={t('moodboard.fontStyle')}
              value={mixedStyle ? '' : styleKey(first.fontWeight, first.fontItalic)}
              onChange={(event) => {
                const picked = styles.find((s) => styleKey(s.weight, s.italic) === event.target.value);
                if (picked) onChange({ fontWeight: picked.weight, fontItalic: picked.italic });
              }}
            >
              {mixedStyle && <option value="">{t('moodboard.mixed')}</option>}
              {styles.map((s) => (
                <option key={styleKey(s.weight, s.italic)} value={styleKey(s.weight, s.italic)}>
                  {styleName(s.weight, s.italic)}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex w-20 flex-col gap-[5px]">
            <span className="sb-label">{t('moodboard.fontSize')}</span>
            <input
              key={`${selectionKey}|${String(first.fontSize)}|${String(mixedSize)}`}
              type="number"
              min={4}
              max={1000}
              defaultValue={mixedSize ? '' : first.fontSize}
              placeholder={mixedSize ? t('moodboard.mixed') : ''}
              onBlur={(event) => {
                const size = Number(event.target.value);
                if (Number.isFinite(size) && size > 0) onChange({ fontSize: size });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className="h-8 w-full border border-text bg-surface-raised px-2 font-mono text-[13px] text-text"
            />
          </label>
          <div role="group" aria-label={t('moodboard.align')} className="flex">
            {ALIGNS.map((align, i) => {
              const on = !mixedAlign && first.align === align;
              return (
                <button
                  key={align}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onChange({ align });
                  }}
                  className={cx(
                    'sb-label flex h-8 items-center border border-text px-2.5 focus-visible:-outline-offset-4',
                    i > 0 && '-ml-px',
                    on ? 'bg-text font-bold text-text-inverse focus-visible:outline-text-inverse' : 'text-text hover:bg-surface-raised',
                  )}
                >
                  {ALIGN_LABEL[align]()}
                </button>
              );
            })}
          </div>
        </>
      )}
      {onArrange && fields.length >= 2 && <Arrange count={fields.length} onArrange={onArrange} />}
    </div>
  );
}
