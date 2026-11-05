import { useRef } from 'react';
import { localDateTime } from '../../app/format';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { canPutBack, putBackChange } from './putBack';
import { changeLabel, changeText, frameRows, isMono, who, type FieldChange } from './summary';
import { t } from '../../core/i18n';

// One item's own history (1.22): a frame, a scene or a note, every change to it newest first, field by field, each
// with its old value to put back. Values show in full, line breaks and all: an old action or dialogue is read here
// before it goes back over the one there now, so it's never cut short (a step's one-line summary is).

/**
 * Every change to one item, newest first. `title` names it in a sentence ("frame 4A", "scene SC 05", "this note");
 * `places` names a location by its id, as the board has it now.
 */
export function ItemHistory({
  item,
  title,
  ops,
  places,
  busy = false,
  onPutBack,
}: {
  item: SbdRecord;
  title: string;
  ops: readonly LoggedOp[];
  places: (id: string) => string | null;
  /** A Restore to here is running: Put back takes no clicks until it lands (the tile ignores them too). */
  busy?: boolean;
  onPutBack: (recordId: string, field: FieldChange) => Promise<boolean>;
}) {
  const table = useRef<HTMLTableElement>(null);
  const rows = frameRows(ops, item.id);
  if (rows.length === 0) return <p className="p-3 text-[13px] text-text-muted">{t('history.noChangesTo', { title })}</p>;
  const putBack = (recordId: string, field: FieldChange) => {
    void onPutBack(recordId, field).then(() => {
      // The pressed button goes once its value is back: focus stays on the table rather than falling out of the
      // window, so the next Tab reaches the rows again.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === null) table.current?.focus();
      });
    });
  };
  // A scene keeps its location by id, which means nothing to a person.
  const value = (field: FieldChange, v: JsonValue | undefined): string =>
    field.prop === 'location_id' && typeof v === 'string' && v !== '' ? (places(v) ?? t('history.aLocation')) : changeText(field, v);
  return (
    <table ref={table} tabIndex={-1} aria-busy={busy} className="w-full border-collapse text-[12px]">
      <caption className="sr-only">{t('history.changesTo', { title })}</caption>
      <thead>
        <tr className="border-b border-border">
          {[t('history.col.change'), t('history.col.before'), t('history.col.after'), t('history.col.who'), t('history.col.when'), ''].map((head) => (
            <th key={head} scope="col" className="sb-label px-2 py-1.5 text-left font-normal text-text-muted">
              {head === '' ? <span className="sr-only">{t('itemHistory.putBack')}</span> : head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, op, change, field }) => {
          const mono = field !== null && field.key === undefined && isMono(field.prop);
          // Offered only where it would change something: the value already there is no step to take.
          const offered = field !== null && canPutBack(item.type, field) && putBackChange(item, field) !== null;
          const cell = cx('px-2 py-1.5 align-top whitespace-pre-wrap wrap-anywhere', mono && 'font-mono');
          return (
            <tr key={key} className="border-b border-border">
              <td className="px-2 py-1.5 align-top">{change}</td>
              <td className={cell}>{field ? value(field, field.before) : ''}</td>
              <td className={cell}>{field ? value(field, field.after) : ''}</td>
              {/* An edit from before names were kept has none: a dash, so the column still reads as one. */}
              <td className="px-2 py-1.5 align-top">{who(op.author) || '—'}</td>
              <td className="px-2 py-1.5 align-top font-mono whitespace-nowrap">{localDateTime(new Date(op.timestamp))}</td>
              <td className="px-2 py-1 text-right align-top">
                {offered && (
                  <Button
                    aria-label={t('history.putBackLabel', { field: changeLabel(field), value: value(field, field.before) })}
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      putBack(op.recordId, field);
                    }}
                  >
                    {t('itemHistory.putBack')}
                  </Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
