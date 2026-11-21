# Brief: a HEIC as a key image or a logo on Windows (Kevin, Nov 20)

Work in the repo folder on branch `fix/heic-key-image` (already checked out, made from `v2` after HEIC on Windows
merged; don't switch). You write code and tests and run the checks below. You never commit, push or merge. Read
CLAUDE.md's Workflow and Safety sections, then `docs/briefs/heic-page.md` (how the page asks Rust for a HEIC it can't
read: `src/core/media/heic.ts`, `image.ts`'s `decodePicture`, `src/app/heicPicture.ts`, the count in the status
line).

## Why

WebView2 can't decode a HEIC, so on Windows the storyboard's, the boards' and the locations' pictures now go to
Rust's `heic_picture` when the page can't read them (6.27n). Two ways in were left out, and said so: a project's key
image or logo, whose accents the theme reads (`src/app/theme/themeEdits.ts`, `extractAccents`), and a company's logo.
Picked on Windows, a HEIC fails there today.

Kevin, Nov 20, his words:

> A HEIC as a key image or a logo on Windows goes through the same fallback.

## What to build

- Find every place a person gives the app a picture that is a key image or a logo (the onboarding dialog, Settings →
  Theme, the project's logo, a company profile's logo, and any other you find: list them).
- Each takes a HEIC on Windows as it does on a Mac: the same fallback the other pictures use turns it into something
  the page can read, once, and that is what its accents are read from and what is stored, exactly as a JPEG of the
  same picture would be stored (size limits, cleaning, colour, all as they are).
- Don't decode the same HEIC twice for one pick (the accents and the stored picture come from the one decode).
- A refusal (too large, HDR, took too long, couldn't be read, its profile too large) shows the same words the other
  ways in show, where that screen shows a failed pick today. No new words.
- While it is being read, the screen says so the way it already says a picture's colours are being read; if there
  is a place where a slow decode would look like nothing happening, say where and what you did.
- On a Mac nothing changes: the page reads HEIC itself.
- The accent reader's worker gets what the page can read, never the HEIC bytes it can't decode.

## Tests

- Unit: the function each way in calls gets a decoded picture for a HEIC when the page can't read it (the decoder set
  with `setHeicDecoder` in a test, as heic-page's tests do), calls the decoder once per pick, and passes a refusal's
  words through.
- End to end in Chromium (which, like WebView2, can't decode HEIC): pick the committed proof HEIC
  (`src-tauri/testdata/heic/`, as `e2e/media.spec.ts` does, with the stand-in decoder those tests use) as a key image
  and as a logo: the theme takes its accent and the picture shows. Follow how the existing key-image and logo specs
  pick a file (`e2e/projectTheme.spec.ts` and the company profile's spec).
- No existing test or assertion changes. If one would have to, stop and report.

## Checks to run

- `npx tsc --noEmit`, `npx eslint` on touched files.
- Unit: `node test-results/build627b/vitestUpper.cjs src/app src/core/media src/ui/theme src/features` (this shell's
  lower-case drive letter makes plain Vitest fail every file; that helper runs it from `C:\`).
- End to end, alone, `--project=chromium --workers=4`, counts read from the output: `e2e/projectTheme.spec.ts`,
  `e2e/media.spec.ts` and the specs you added to.
- Logs go under `test-results/heic-key-image/`.

## Don't touch

- Rust's `heic_picture` and its rules. `e2e/visual.spec.ts` and its snapshots.
- CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, docs/ALPHA_TEST.md, `.github`, `.claude`.
- Kevin's sample photos (`private/samples`).
- No new dependency. No prettier. Every word people see through `t()` in en and es. Never start a command with
  `python`. Nothing fetched through npx.

## Report back

The ways in you found and what each does now; where the one decode happens; each new test's name and result; each
check's output line with counts; every test that failed on the way, by name.
