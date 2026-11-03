import type { Migration } from '../migrate';

// Schema v3 (1.10, approved Nov 2): images stored in the .sbd. A frame's picture is a `media` record (its props say
// which file, its size and colour space, and where it came from); the bytes live here, apart from the records, so
// the History, which keeps whole records before and after each edit, never copies an image.
//
// Files are content-addressed by the SHA-256 of their bytes: the same picture used twice is stored once, a file is
// never changed after it's written, and undo or a restore can always find the picture an older record points to.
// Only Empty Trash removes a file, once nothing in the History refers to it.
//
// The migration also adds the record types `note`, `character` and `stroke`. They need no table, but an older app
// would refuse a record type it doesn't know, so the schema version rises with them.

export const media: Migration = {
  version: 3,
  description: 'Images in the file: media_files and thumbnails; note, character and stroke records',
  statements: [
    {
      // Originals as stored: at most 2560px on the long edge, colour kept (Display P3 or sRGB). The bytes come last in
      // both tables: SQLite reaches a column after a blob only by reading the blob's overflow pages, so reading a
      // picture's size or type, or totalling byte_size, would otherwise read every picture.
      sql: `CREATE TABLE media_files (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL UNIQUE,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        byte_size INTEGER NOT NULL,
        color_space TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        bytes BLOB NOT NULL
      ) STRICT`,
    },
    {
      // Smaller copies the board draws, so a 300-frame grid never decodes 300 full images.
      sql: `CREATE TABLE thumbnails (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL REFERENCES media_files (sha256),
        long_edge INTEGER NOT NULL,
        mime TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        bytes BLOB NOT NULL,
        UNIQUE (sha256, long_edge)
      ) STRICT`,
    },
  ],
};
