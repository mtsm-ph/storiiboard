import { useEffect, useRef, useState } from 'react';
import { projectStore } from '../../app/projectStore';
import { formatDate, localizeError, t, tn } from '../../core/i18n';
import { coordinatesLabel, type Place } from '../../core/net/places';
import { Button } from '../../ui/Button';
import { findPlaces, type Found } from './findPlaces';
import { placeLocation, unplaceLocation } from './locationEdits';

// The address search under a location's address (3.4): Search looks up what's typed (the address, else the name) only
// when pressed, never as it's typed (Nominatim's policy, and the crew's data stays put until asked). What's found is
// listed with its coordinates; picking one puts it on the location, one ⌘Z. The place on the map shows below, with
// Clear. OpenStreetMap's credit sits with the results, as its licence asks.

type State =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | ({ kind: 'found'; query: string } & Found)
  | { kind: 'failed'; message: string };

interface AddressSearchProps {
  locationId: string;
  /** The place on the map now, or none. */
  place: Place | null;
  /** The words to search for, as typed now: the address, else the name. */
  query: () => string;
}

export function AddressSearch({ locationId, place, query }: AddressSearchProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const searchButton = useRef<HTMLButtonElement>(null);
  // Each search's turn: only the latest one's answer is shown, and none after the editor has gone.
  const turn = useRef(0);
  useEffect(
    () => () => {
      turn.current += 1;
    },
    [],
  );

  const search = (again: boolean) => {
    if (state.kind === 'searching') return;
    const words = query().trim();
    if (words === '') {
      setState({ kind: 'failed', message: t('error.noSearch') });
      return;
    }
    const mine = ++turn.current;
    // Search again goes as its search starts: focus to Search, beside it, never to the page.
    if (again) searchButton.current?.focus();
    setState({ kind: 'searching' });
    findPlaces(words, again).then(
      (found) => {
        if (turn.current === mine) setState({ kind: 'found', query: words, ...found });
      },
      (error: unknown) => {
        if (turn.current === mine) setState({ kind: 'failed', message: localizeError(error instanceof Error ? error.message : String(error)) });
      },
    );
  };

  const pick = (chosen: Place, searched: string) => {
    // Places found for words since changed are for another address: never put one on this location.
    if (query().trim() !== searched) {
      setState({ kind: 'failed', message: t('location.searchStale') });
      requestAnimationFrame(() => searchButton.current?.focus());
      return;
    }
    void projectStore
      .getState()
      .applyWith((now) => ({ changes: placeLocation(now, locationId, chosen) }))
      .then(() => {
        setState({ kind: 'idle' });
        // The list it was picked from goes; focus to Search, beside the place now shown.
        requestAnimationFrame(() => searchButton.current?.focus());
      });
  };

  const status =
    state.kind === 'searching'
      ? t('location.searching')
      : state.kind === 'failed'
        ? state.message
        : state.kind === 'found'
          ? state.places.length === 0
            ? t('location.nothingFound', { query: state.query })
            : `${tn('location.found', state.places.length)}${state.saved ? ` ${t('location.savedSearch', { date: formatDate(new Date(state.fetchedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}` : ''}`
          : '';

  return (
    <div className="flex flex-col gap-2" data-address-search="">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={searchButton}
          aria-disabled={state.kind === 'searching' || undefined}
          onClick={() => {
            search(false);
          }}
        >
          {t('location.searchAddress')}
        </Button>
        {state.kind === 'found' && state.saved && (
          <Button
            onClick={() => {
              search(true);
            }}
          >
            {t('location.searchAgain')}
          </Button>
        )}
      </div>
      {/* Always in the page (out of sight while empty, never display: none), so each new status is read out. */}
      <p role="status" className={status === '' ? 'sr-only' : 'text-[12px]'}>
        {status}
      </p>
      {state.kind === 'found' && state.places.length > 0 && (
        <>
          <ul aria-label={t('location.placesFound')} className="flex flex-col border border-border">
            {state.places.map((found, i) => (
              <li key={`${String(i)}:${found.name}`} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    pick(found, state.query);
                  }}
                  // Muted never sits on oatmeal (DESIGN.md): the coordinates turn ink on hover.
                  className="group flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-surface-raised focus-visible:-outline-offset-2"
                >
                  <span className="text-[13px]">{found.name}</span>
                  <span className="font-mono text-[12px] text-text-muted group-hover:text-text">{coordinatesLabel(found)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-text-muted">{t('location.mapCredit')}</p>
        </>
      )}
      {place && (
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="sb-label mr-1">{t('location.onMap')}</span>
            {place.name} <span className="font-mono text-[12px]">{coordinatesLabel(place)}</span>
          </p>
          <Button
            onClick={() => {
              void projectStore.getState().applyWith((now) => ({ changes: unplaceLocation(now, locationId) }));
            }}
          >
            {t('location.clearPlace')}
          </Button>
        </div>
      )}
    </div>
  );
}
