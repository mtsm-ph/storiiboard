import type { Migration } from '../migrate';

// Schema v16 (6.27 scout photos, Kevin Nov 16), ONE version for this milestone and for the 6.6 build-mode milestones
// that follow: every new prop they write is listed in docs/SBD_FORMAT.md, Schema v16. 6.27 starts it: what a location's
// photo's EXIF said (`taken_at`, `taken_offset`, `gps_latitude`, `gps_longitude` on its `media` record), a location's
// light reference (`light_photo_id`) and a sun path drawn for it (`at_photo`). No table changes and nothing is
// rewritten, as 015: a file from before opens with every record as it was. The number says a file may hold these, so an
// older Storiiboard refuses it rather than drop what it can't read. migrate() copies the file to a backup before it
// runs, as for every upgrade.

export const scoutPhotos: Migration = {
  version: 16,
  description: 'Scout photos and build mode: props only, no table change',
  statements: [],
};
