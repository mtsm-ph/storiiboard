import type { Migration } from '../migrate';

// Schema v15 (6.5 canvas polish, Kevin Nov 16: "New props go in one schema version"): every new prop the 6.5 milestones
// write, listed in docs/SBD_FORMAT.md, Schema v15. 6.5.5 starts it: a sun path's own place and date (`own_latitude`,
// `own_longitude`, `own_date`), and the `settings_preset` record type for 6.5.8. No table changes and nothing is
// rewritten: a record's `type` is plain text with no CHECK (001_initial.ts), so a new type needs only its line in
// RECORD_TYPES (src/core/model/record.ts). A file from before opens with every record as it was. The number says a file
// may hold these, so an older Storiiboard refuses it rather than drop what it can't read. migrate() copies the file to a
// backup before it runs, as for every upgrade.

export const canvasPolish: Migration = {
  version: 15,
  description: 'Canvas polish: props and the settings_preset type only, no table change',
  statements: [],
};
