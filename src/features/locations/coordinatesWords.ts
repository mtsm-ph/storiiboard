import type { MessageKey } from '../../core/i18n';
import type { CoordinatesRefusal } from '../../core/model/coordinates';

// Why pasted coordinates were refused (6.5.5), in words: the Locations tile's field and a sun path's own place both say
// these, so the two never explain the same mistake two ways.

export const COORDINATES_REFUSED: Readonly<Record<CoordinatesRefusal, MessageKey>> = {
  empty: 'coordinates.refused.empty',
  unreadable: 'coordinates.refused.unreadable',
  decimalComma: 'coordinates.refused.decimalComma',
  latitude: 'coordinates.refused.latitude',
  longitude: 'coordinates.refused.longitude',
};
