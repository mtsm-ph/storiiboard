import { useId, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import { formatCoordinates } from '../../core/model/coordinates';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/fields';
import { COORDINATES_REFUSED } from './coordinatesWords';
import { putPastedCoordinates } from './pasteCoordinates';

// A location's place by pasted coordinates (6.5.5, Kevin Nov 16), beside Search address: what Google Maps copies
// ("40.8677, -73.9212") puts the pin there in one edit, as a moved pin is put (map_moved), its zone then found offline.
// Nothing is looked up: this field never asks Nominatim, nor anything else. The address stays as typed.

export function CoordinatesPaste({ locationId }: { locationId: string }) {
  const field = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState('');
  const help = useId();
  const put = () => {
    const input = field.current;
    if (!input) return;
    void putPastedCoordinates(locationId, input.value).then((outcome) => {
      if (!outcome.ok) {
        setSaid(t(COORDINATES_REFUSED[outcome.reason]));
        return;
      }
      input.value = '';
      setSaid(t('location.pinPlaced', { coordinates: formatCoordinates(outcome.place) }));
    });
  };
  return (
    <div className="flex flex-col gap-1" data-coordinates-paste="">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <TextField
            ref={field}
            label={t('location.coordinates')}
            mono
            autoComplete="off"
            spellCheck={false}
            placeholder={t('coordinates.example')}
            aria-describedby={help}
            data-field="coordinates"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              put();
            }}
          />
        </div>
        <Button onClick={put}>{t('location.placePin')}</Button>
      </div>
      <p id={help} className="text-[12px] text-text-muted">
        {t('location.coordinatesNote')} {t('coordinates.help')}
      </p>
      {/* Always in the page (out of sight while empty), so each new word is read out. */}
      <p role="status" className={said === '' ? 'sr-only' : 'text-[12px]'} data-coordinates-said="">
        {said}
      </p>
    </div>
  );
}
