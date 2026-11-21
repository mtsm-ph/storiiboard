# Brief: Settings, round 2 (#248): what the review found

Work in the repo folder on branch `feat/settings-apply` (the main session checks it out for you; don't switch). You
write code and tests and run the checks below. You never commit, push or merge. Read `docs/briefs/settings-apply.md`
(round 1, with Kevin's words) first.

The review found the drafts, Apply, the close question, presets with drafts, the Measurement system, m | ft and the
export right. These are its findings.

1. **Two settings of this computer still apply at once and aren't on the list** (medium). Storage → Playback copies'
   cap and floor (PlaybackCopies.tsx, saved to Rust on blur or Enter) become drafts like Backups' numbers: Apply writes
   them through their own setters, Discard drops them. The tile server in Online services keeps its own Save (the
   system asks to confirm a new host) and stays at once: name it, with that reason, in the list in `drafts.ts`, and
   Company profiles with theirs. Kevin asked "say which… and why": the code's list must name every one.
2. **A typed number turns Apply on at once** (low): Backups' (and the playback copies') number fields draft on each
   change once the text reads as a number, as Profile's name does, so one click on Apply applies them.
3. **The Backups place line** (low) says where backups go by the applied setting, not the draft, or says both ("after
   Apply: …"), so it never disagrees with the folder shown under it.
4. **Apply's focus ring and border in Dark** (low): on the accent fill use the accent-contrast ring (DESIGN.md: "on
   orange use accent-contrast") and the primary button's own Dark border, as `Button` primary does.
5. **The test helper's default** (low): `closeSettings` in `e2e/settings.ts` fails when the close question appears
   unless the caller says how to answer it; pass the answer explicitly at every call site that changed something
   (the end-to-end run tells you which). No assertion changes.
6. **Apply never loses a draft** (low): write each draft first and clear it after it is written (or catch per draft and
   keep the ones that failed, saying so), so a setter that throws leaves the rest waiting.
7. **A project switch with drafts waiting** (Open backup, or any open in place while Settings is open): discard the
   project's own drafts (Your role on this project) for the project left, or keep them visibly; say which and test it.
   The app quitting drops drafts without asking: say so in the list (no quit hook in the page today).
8. **Words and tests** (low): rename the two stale titles ("switches the open app at once" in language.spec, the
   trackpadMode comment) to say "on Apply"; a unit test of an upgrade with only one unit saved (`{ planUnits:
   'feet' }`): it reads Mixed and shows what it showed.

Left as is (say so): "Printed units" for the export's label (Kevin's "Units on paper" clashed with specs' `name:
'Paper'`); Mixed read from the choices, not from what shows.

## Rules

No assertion from before #248 changes; round 1's stay (titles may be renamed, item 8). Words through `t()` in en and
es. Nothing stored in the project changes. No new dependency. Don't touch `e2e/visual.spec.ts` or any baseline (say if
you expect one to change), CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md, `.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit tests of the folders you touch; end to end, alone, counts
read from the output: `e2e/settingsApply.spec.ts e2e/sidebar.spec.ts e2e/language.spec.ts e2e/trackpadMode.spec.ts`
and every spec whose `closeSettings` call you change, `--project=chromium --workers=4`. Logs under
`test-results/settings-apply/` (names ending `-r2`). Never start a command with `python`. Nothing fetched through npx.

## Report back

For each numbered item: what you changed; each new or renamed test's name and result; each check's output line with
counts.
