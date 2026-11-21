# Brief: the words for a clip's destination that stops answering (Kevin, Nov 20 night)

Work in the repo folder on branch `fix/dead-destination-words` (made from `v2`; already checked out; don't switch). You
write code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/encoder-leftovers*.md`
(#235, merged) first: when the folder a clip is being saved to stops answering, the app today says the general "That
video took too long to read. If it's on a network drive, copy it to this computer first." (`video.rs`, matched by
`localizeError` to `error.videoTooSlow`), which speaks of reading though the clip was being saved.

Kevin's words, exactly:
- en: "The folder this clip is being saved to stopped responding. If it's on a drive or a network share, check it's still
  connected, or save the clip somewhere else."
- es: "La carpeta donde se guarda este clip dejó de responder. Si está en un disco o una unidad de red, revisa que siga
  conectado, o guarda el clip en otro lugar."

Give that case its own message: a new constant in Rust (beside the others in video.rs) for the save's destination
stalling, used only where the destination (not the source) stopped answering, and a new key in en.ts and es.ts matched
by `localizeError` the way the others are (the `i18n.test.ts` checks that both sides stay equal). Every other use of
"took too long to read" stays. Tests: the Rust test that makes a destination stop answering expects the new words; the
page shows them in Spanish too. No other existing assertion changes; the ones that state the old words for this one
case change with them (list each).

Checks: `npx tsc --noEmit`; `npx eslint` on the touched files; the unit tests of the folders you touch
(`node test-results/build627b/vitestUpper.cjs <folders>`); from src-tauri `cargo fmt --check`, `cargo clippy
--all-targets -- -D warnings`, `cargo test video` and the whole `cargo test` (say which tests run only on Linux). Logs
under `test-results/dead-destination/`. Never start a command with `python`. Nothing fetched through npx. No new
dependency. Don't touch CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`, baselines. No prettier.

Report back: where the case is told apart, the new constant and key, each changed test line, each check's output line
with counts.
