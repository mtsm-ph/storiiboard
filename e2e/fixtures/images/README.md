# Test pictures

No picture here is anyone else's: every pixel was drawn here, by a script in this repo or by hand for the tests.
adobe-rgb.jpg and p3-red.jpg carry colour profiles made by others (Adobe RGB and Display P3), as embedded in many
files: data that says how to read the colours, not pictures.

| File | Size | What made it |
|---|---|---|
| photo-a.jpg | 967 × 523 | `node scripts/fixturePhotos.ts`: a dusk street, drawn on a canvas in Playwright's Chromium, its own sRGB profile (1,024-point curve) |
| photo-b.jpg | 967 × 521 | `node scripts/fixturePhotos.ts`: a meadow by day, the same way, its own sRGB profile (4,096-point curve) |
| adobe-rgb.jpg | 64 × 48 | made by hand, Nov 3 |
| alpha.png | 64 × 64 | made by hand, Nov 3 |
| p3-red.jpg | 64 × 48 | made by hand, Nov 3 |
| rotated.jpg | 80 × 40 as stored, with an EXIF rotation | made by hand, Nov 3 |
| srgb.jpg | 64 × 48 | made by hand, Nov 3 |

The same script writes the prototype's four uploads (prototype/uploads): small_LF7JADRW.jpg is photo-a.jpg's bytes,
small_NVTE6ECR.jpg is photo-b.jpg's, and small_EE2UMJ1P.jpg (a room at night, 967 × 403) and small_KDGP7IMR.jpg (a
desert, 967 × 410) are its own. Running it again in the same Chromium version writes the same bytes. scripts/fixturePhotos.test.ts checks that each
passes our own clean (src/core/media/cleanPicture.ts) unchanged.

If the drawn photos change, measure deckPictures' MATCH_THRESHOLD again as its comment in
src/features/export/deckPictures.ts describes.
