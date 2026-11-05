import type { Migration } from '../migrate';

// Schema v8 (Phase 2, approved by Kevin Nov 5): video. Videos stay outside the .sbd (CLAUDE.md); a `media` record of
// kind `video` points at one and keeps what ffprobe read (src/core/media/video.ts). A frame plays part of one through
// its `clip` prop, and a picture grabbed from one says where it came from in `from_video`. Those are props, which need
// no table; the version still rises with them, so an older Storiiboard doesn't open a file whose frames it would show
// without their clips.
//
// The one table is for LUTs (2.5): a `.cube` file's text, kept in the file so a moved or shared project keeps its look.
// Content-addressed like pictures: the same LUT loaded twice is stored once, a row is never changed after it's
// written, and a video names its LUT by id in a prop, so undo and History restore a LUT change like any other edit.

export const video: Migration = {
  version: 8,
  description: 'Video: video media records, clip and from_video props; luts',
  statements: [
    {
      // The text comes last, as the bytes do in media_files: reading a LUT's name or size never reads the LUT.
      sql: `CREATE TABLE luts (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        cube TEXT NOT NULL
      ) STRICT`,
    },
  ],
};
