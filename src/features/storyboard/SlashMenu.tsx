import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../ui/cx';
import { t } from '../../core/i18n';

// The "/" menu (1.12): press / on the board to insert a frame, a scene, a note or a location right where the keys
// are, without the mouse. It's a combobox: typing narrows the list, the arrows pick, Enter inserts, Escape closes and
// focus goes back where it was. Location asks for a name next, offering the project's own locations first.

export type SlashChoice = { kind: 'frame' | 'scene' | 'note' } | { kind: 'location'; name: string };

interface Option {
  id: string;
  label: string;
  hint: string;
  choice: SlashChoice | 'location';
}

interface SlashMenuProps {
  /** Where to open: under this point, in viewport pixels. */
  at: { left: number; top: number };
  /** "SC 04", for the hints. */
  sceneLabel: string;
  /** Opened on the scene's + Frame, so a frame or a note goes at its end. */
  atEnd?: boolean;
  /** The project's locations, for the second step. */
  locationNames: readonly string[];
  onPick: (choice: SlashChoice) => void;
  onClose: () => void;
}

const WIDTH = 264;

export function SlashMenu({ at, sceneLabel, atEnd = false, locationNames, onPick, onClose }: SlashMenuProps) {
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<'insert' | 'location'>('insert');
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [place, setPlace] = useState(at);

  const typed = query.trim();
  const options: Option[] =
    step === 'insert'
      ? (
          [
            { id: 'frame', label: t('slash.frame'), hint: atEnd ? t('slash.atEndOf', { scene: sceneLabel }) : t('slash.afterThis'), choice: { kind: 'frame' } },
            { id: 'scene', label: t('slash.scene'), hint: t('slash.after', { scene: sceneLabel }), choice: { kind: 'scene' } },
            { id: 'note', label: t('slash.note'), hint: atEnd ? t('slash.atEndOf', { scene: sceneLabel }) : t('slash.afterThis'), choice: { kind: 'note' } },
            { id: 'location', label: t('slash.location'), hint: t('slash.for', { scene: sceneLabel }), choice: 'location' },
          ] satisfies Option[]
        ).filter((option) => option.label.toLowerCase().includes(typed.toLowerCase()))
      : [
          ...locationNames
            .filter((name) => name.toLowerCase().includes(typed.toLowerCase()))
            .map((name, i): Option => ({ id: `location-${String(i)}`, label: name, hint: t('slash.inProject'), choice: { kind: 'location', name } })),
          ...(typed !== '' && !locationNames.some((name) => name.toLowerCase() === typed.toLowerCase())
            ? [{ id: 'location-new', label: t('slash.newLocation', { name: typed }), hint: t('slash.addsIt'), choice: { kind: 'location', name: typed } } satisfies Option]
            : []),
        ];
  const current = options[Math.min(active, options.length - 1)];

  // Focus before the first paint, so a key pressed right after "/" already goes to the field; again on the second
  // step, whose field is a new one, so a screen reader announces its label.
  useLayoutEffect(() => {
    input.current?.focus();
  }, [step]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // Kept inside the window, flipping above the point when there's no room below.
  useLayoutEffect(() => {
    const height = panel.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(at.left, window.innerWidth - WIDTH - 8));
    const top = at.top + height + 8 > window.innerHeight ? Math.max(8, at.top - height - 40) : at.top;
    setPlace({ left, top });
  }, [at, step]);

  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.choice === 'location') {
      setStep('location');
      setQuery('');
      setActive(0);
      return;
    }
    onPick(option.choice);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length === 0 ? 0 : (Math.min(i, options.length - 1) + step + options.length) % options.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(current);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Backspace' && query === '' && step === 'location') {
      setStep('insert');
    }
  };

  return (
    <div
      ref={panel}
      className="fixed z-50 flex flex-col border-[1.5px] border-text bg-surface"
      style={{ left: place.left, top: place.top, width: WIDTH }}
    >
      <label htmlFor={`${listId}-input`} className="sb-label px-2 pt-1.5 text-text-muted">
        {step === 'insert' ? t('slash.insert') : t('slash.locationFor', { scene: sceneLabel })}
      </label>
      <input
        key={step}
        ref={input}
        id={`${listId}-input`}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? `${listId}-${current.id}` : undefined}
        value={query}
        placeholder={step === 'insert' ? t('slash.placeholder') : t('slash.locationName')}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        // Placeholder at 70% ink, as src/ui/fields.tsx has it: the browser's own grey falls below AA on oatmeal.
        className="mx-2 my-1.5 border border-text bg-surface-raised px-2 py-1 text-[13px] text-text placeholder:text-text/70"
      />
      <div id={listId} role="listbox" aria-label={step === 'insert' ? t('slash.insert') : t('slash.locations')} className="flex flex-col pb-1">
        {options.map((option) => {
          const selected = option === current;
          return (
            <div
              key={option.id}
              id={`${listId}-${option.id}`}
              role="option"
              aria-selected={selected}
              // A press picks without taking focus from the field.
              onPointerDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              className={cx('flex cursor-pointer items-baseline justify-between gap-2 px-2 py-1', selected && 'bg-text text-text-inverse')}
            >
              <span className="text-[13px] font-semibold">{option.label}</span>
              <span className={cx('sb-label', selected ? 'text-text-inverse' : 'text-text-muted')}>{option.hint}</span>
            </div>
          );
        })}
      </div>
      {options.length === 0 && (
        <p className="px-2 pb-1.5 text-[12px] text-text-muted">{step === 'insert' ? t('slash.nothing') : t('slash.typeName')}</p>
      )}
    </div>
  );
}
