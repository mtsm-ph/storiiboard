# Brief: American spelling in every word a person sees ("Color"; Kevin, Nov 20)

Work in the repo folder on the branch the main session checks out for you (`polish/color-spelling`, stacked on #250;
don't switch). You write code and tests and run the checks below. You never commit, push or merge. Read
`private/COLOR_PLAN.md` (the inventory) first.

## Kevin's word (Nov 20, night)

"'Color': go. American spelling in every word a person sees (the English strings, and Rust's words that people read).
Names in code, keys, comments and docs stay."

## What changes

- **`src/core/i18n/locales/en.ts` values only** (never keys, never placeholders): colour → color (and colours, coloured
  …), centre → center, licence (the noun) → license, grey → gray, cancelled → canceled, tick → check (where it means
  marking a box: "can tick Approved" → "can check Approved"; read each), Metres → Meters (and metre/metres in any word
  people see). Already American or not British (leave): "Dialogue", "Trash", "Maximize", "SIL Open Font License".
  Spanish (`es.ts`) is not touched.
- **English people see outside en.ts**: the seven messages written in English in Rust or TypeScript and matched by
  `localizeError` (heic.rs `PROFILE_TOO_BIG`; sbd.rs and driver.ts `PICTURE_NOT_CLEAN`; licences.rs's "That licence
  isn't in this copy…"; playback.rs `CANCELLED`; video.rs `CLIP_CANCELLED`; color.ts's "Not a colour: …"; sample.ts's
  "This computer can't read the image's colours.") change in the same commit as their en.ts lines, so the two sides
  stay equal (the `i18n.test.ts` checks); the four lines `scripts/ffmpeg/build.sh` writes into the notes the Licenses
  window shows. Any other English a person reads (a PDF's words, a CSV header, a notice from Rust): search for it.
- **Never stored values**: a location's status `cancelled` and the Plan units setting `metres` stay exactly as they
  are, in the file, in JSON exports, in History and in this computer's settings; only the words shown for them change.
- **Names in code, keys, file names, comments and docs** stay as they are (including the duplicate plural keys).
- **Tests**: expectations that state the English words change with the words (the end-to-end specs that pick "Metres",
  the unit tests, the one Rust test); nothing else. Every changed assertion is only the word's spelling.

## The PR's list

Write `test-results/color-spelling/strings.md`: every changed string, old and new, with its key (or file and line for
Rust and scripts), grouped by word family; and every test line changed, file and line. The main session puts it in the
PR.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; the whole unit suite (`node
test-results/build627b/vitestUpper.cjs`); from src-tauri `cargo fmt --check`, `cargo clippy --all-targets -- -D
warnings`, `cargo test`; end to end, alone, counts read from the output: every spec you change, `--project=chromium
--workers=4`. Logs under `test-results/color-spelling/`. Never start a command with `python`. Nothing fetched through
npx. No new dependency. Don't touch `e2e/visual.spec.ts`'s baselines (say which pictures will change: a "Color" word
in a picture), CLAUDE.md, docs/, design/, `.github`, `.claude`. No prettier.

## Report back

The counts by family; the path of strings.md; every changed test line; each check's output line with counts; the
pictures that will change.
