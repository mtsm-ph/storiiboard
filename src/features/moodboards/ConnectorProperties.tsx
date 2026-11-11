import { t } from '../../core/i18n';
import { Select, TextField } from '../../ui/fields';
import type { Head, Route } from '../../ui/canvas/types';
import { changeConnector } from './boardActions';
import { ColourControl } from './ColourControl';
import { HEADS, MAX_CONNECTOR_WIDTH, MIN_CONNECTOR_WIDTH, ROUTES, type ConnectorFields } from './connectorFields';
import { BOARD_INK } from './items';

// What the properties strip shows for the selected connectors (5.2): route, the two heads, colour, width and, for one, its
// label. A change is one op group for every connector selected. Where they differ the control says Mixed.

const ROUTE_NAME: Readonly<Record<Route, () => string>> = {
  straight: () => t('moodboard.connector.straight'),
  elbow: () => t('moodboard.connector.elbow'),
  curved: () => t('moodboard.connector.curved'),
};
const HEAD_NAME: Readonly<Record<Head, () => string>> = {
  none: () => t('moodboard.connector.noHead'),
  arrow: () => t('moodboard.connector.arrow'),
};

const same = <T,>(items: readonly T[], get: (item: T) => unknown): boolean => items.every((item) => get(item) === get(items[0] as T));

interface Props {
  boardId: string;
  fields: readonly ConnectorFields[];
  /** Changes with the selection, so the width and label fields start again from the new selection's value. */
  selectionKey: string;
}

export function ConnectorProperties({ boardId, fields, selectionKey }: Props) {
  const [first] = fields;
  if (!first) return null;
  const mixedRoute = !same(fields, (f) => f.route);
  const mixedStart = !same(fields, (f) => f.startHead);
  const mixedEnd = !same(fields, (f) => f.endHead);
  const mixedWidth = !same(fields, (f) => f.width);
  const one = fields.length === 1;
  return (
    <>
      <div className="w-32">
        <Select
          label={t('moodboard.connector.route')}
          data-connector-route=""
          value={mixedRoute ? '' : first.route}
          onChange={(event) => {
            const route = ROUTES.find((r) => r === event.target.value);
            if (route) void changeConnector(boardId, { route });
          }}
        >
          {mixedRoute && <option value="">{t('moodboard.mixed')}</option>}
          {ROUTES.map((r) => (
            <option key={r} value={r}>
              {ROUTE_NAME[r]()}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-28">
        <Select
          label={t('moodboard.connector.startHead')}
          data-connector-start=""
          value={mixedStart ? '' : first.startHead}
          onChange={(event) => {
            const head = HEADS.find((h) => h === event.target.value);
            if (head) void changeConnector(boardId, { startHead: head });
          }}
        >
          {mixedStart && <option value="">{t('moodboard.mixed')}</option>}
          {HEADS.map((h) => (
            <option key={h} value={h}>
              {HEAD_NAME[h]()}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-28">
        <Select
          label={t('moodboard.connector.endHead')}
          data-connector-end=""
          value={mixedEnd ? '' : first.endHead}
          onChange={(event) => {
            const head = HEADS.find((h) => h === event.target.value);
            if (head) void changeConnector(boardId, { endHead: head });
          }}
        >
          {mixedEnd && <option value="">{t('moodboard.mixed')}</option>}
          {HEADS.map((h) => (
            <option key={h} value={h}>
              {HEAD_NAME[h]()}
            </option>
          ))}
        </Select>
      </div>
      <ColourControl label={t('moodboard.connector.colour')} value={first.color} mixed={!same(fields, (f) => f.color)} unset={BOARD_INK} onChange={(color) => { void changeConnector(boardId, { color }); }} />
      <label className="flex w-20 flex-col gap-[5px]">
        <span className="sb-label">{t('moodboard.connector.width')}</span>
        <input
          key={`${selectionKey}|${String(first.width)}|${String(mixedWidth)}`}
          type="number"
          min={MIN_CONNECTOR_WIDTH}
          max={MAX_CONNECTOR_WIDTH}
          step={0.5}
          data-connector-width=""
          defaultValue={mixedWidth ? '' : first.width}
          placeholder={mixedWidth ? t('moodboard.mixed') : ''}
          onBlur={(event) => {
            const width = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(width) && width > 0) void changeConnector(boardId, { width });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="h-8 w-full border border-text bg-surface-raised px-2 font-mono text-[13px] text-text"
        />
      </label>
      {one && (
        <div className="w-56">
          <TextField
            key={`${selectionKey}|${first.label}`}
            label={t('moodboard.connector.label')}
            data-connector-label=""
            defaultValue={first.label}
            autoComplete="off"
            onBlur={(event) => {
              void changeConnector(boardId, { label: event.currentTarget.value });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </div>
      )}
    </>
  );
}
