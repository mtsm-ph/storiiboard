import type { Migration } from '../migrate';

// Schema v14 (Phase 6, docs/PHASE6_DECISIONS.md 16, approved by Kevin Nov 13: "props only, one schema version for
// everything these answers need"): camera bodies and lenses on `gear_item`, a frame's `lens_id`, and the props the
// bird's-eye plans write on `scene`, `plan` and `plan_item` (every one listed in docs/SBD_FORMAT.md, Schema v14).
// No table changes and nothing is rewritten: a file from before opens with every record as it was. The number says
// a file may hold those props, so an older Storiiboard refuses it rather than open plans it can't keep. migrate()
// copies the file to a backup before it runs, as for every upgrade.

export const plans: Migration = {
  version: 14,
  description: 'Bodies, lenses and plans: props only, no table change',
  statements: [],
};
