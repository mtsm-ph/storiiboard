import { useId, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import { isStretch, stretchLabel, type Stretch } from '../../core/model/availability';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';

// A person's unavailable dates in Cast and crew (7.3, docs/PHASE7_DECISIONS.md 6): each stretch with its note and a
// Remove, and "Add dates…", which opens a From, a To (the From's date until one is picked) and a note. Whole dates
// only. Each add and each remove is one op group, so one ⌘Z. The date fields are the browser's own, typed from the
// keyboard as well as picked.

interface Props {
  stretches: readonly Stretch[];
  /** Resolves true once the stretch is saved. */
  onAdd: (from: string, to: string, note: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}

export function UnavailableDates({ stretches, onAdd, onRemove }: Props) {
  const headingId = useId();
  const badId = useId();
  const box = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const fromField = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Whether the To has been edited: until then it shows the From's date; after, only its own, even when cleared, so a
  // To typed part by part (an empty value until it's whole) is never overwritten by the From.
  const [toTouched, setToTouched] = useState(false);
  const [note, setNote] = useState('');
  // How many refusals in a row: 0 for none. The words are drawn afresh at each, so a second bad Add is said again.
  const [bad, setBad] = useState(0);
  const until = toTouched ? to : from;

  const close = () => {
    setAdding(false);
    setFrom('');
    setTo('');
    setToTouched(false);
    setNote('');
    setBad(0);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const submit = () => {
    if (!isStretch(from, until)) {
      setBad((n) => n + 1);
      return;
    }
    void onAdd(from, until, note).then((done) => {
      if (done) close();
    });
  };

  return (
    <div ref={box} role="group" aria-labelledby={headingId} className="flex flex-col gap-1" data-unavailable="">
      <h4 id={headingId} className="sb-label">
        {t('person.unavailable')}
      </h4>
      {stretches.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t('person.unavailableNone')}</p>
      ) : (
        <ul className="flex flex-col">
          {stretches.map((stretch, i) => {
            const dates = stretchLabel(stretch.from, stretch.to);
            return (
              <li key={stretch.record.id} data-stretch={stretch.record.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border py-1 text-[13px]">
                <span className="font-mono">{dates}</span>
                {stretch.note !== '' && (
                  <span data-user-text="" className="min-w-0 flex-1 break-words">
                    {stretch.note}
                  </span>
                )}
                <Button
                  className="ml-auto"
                  data-remove-stretch={stretch.record.id}
                  aria-label={t('person.unavailableRemoveNamed', { dates })}
                  onClick={() => {
                    const next = stretches[i + 1] ?? stretches[i - 1] ?? null;
                    void onRemove(stretch.record.id).then((done) => {
                      if (!done) return;
                      // To the stretch after it, else the one before, else Add dates.
                      requestAnimationFrame(() => {
                        const button = next ? box.current?.querySelector<HTMLElement>(`[data-remove-stretch="${CSS.escape(next.record.id)}"]`) : null;
                        (button ?? addButton.current)?.focus();
                      });
                    });
                  }}
                >
                  {t('person.unavailableRemove')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape leaves the form; the fields and buttons inside are the controls
        <form
          data-add-stretch=""
          // Our own words for dates out of order, not the browser's bubble for the To field's min.
          noValidate
          className="flex flex-col gap-2 border border-border p-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          // Escape anywhere in the form (a field, Add dates, Cancel) leaves it without adding.
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            close();
          }}
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
            <TextField
              ref={fromField}
              label={t('person.unavailableFrom')}
              type="date"
              mono
              value={from}
              data-stretch-from=""
              aria-invalid={bad > 0 || undefined}
              aria-describedby={bad > 0 ? badId : undefined}
              onChange={(event) => {
                setFrom(event.currentTarget.value);
                setBad(0);
              }}
            />
            <TextField
              label={t('person.unavailableTo')}
              type="date"
              mono
              value={until}
              min={from || undefined}
              data-stretch-to=""
              aria-invalid={bad > 0 || undefined}
              aria-describedby={bad > 0 ? badId : undefined}
              onChange={(event) => {
                setTo(event.currentTarget.value);
                setToTouched(true);
                setBad(0);
              }}
            />
          </div>
          <TextField
            label={t('person.unavailableNote')}
            value={note}
            data-stretch-note=""
            autoComplete="off"
            onChange={(event) => {
              setNote(event.currentTarget.value);
            }}
          />
          {bad > 0 && (
            <p key={bad} id={badId} role="alert" className="text-[12px] text-warning dark:text-text">
              <span aria-hidden="true">▲ </span>
              {t('person.unavailableBad')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              {t('person.unavailableAdd')}
            </Button>
            <Button onClick={close}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <Button
          ref={addButton}
          className="self-start"
          data-add-dates=""
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => fromField.current?.focus());
          }}
        >
          {t('person.addDates')}
        </Button>
      )}
    </div>
  );
}
