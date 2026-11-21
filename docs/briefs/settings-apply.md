# Brief: Settings: Apply changes, and the Measurement system (Kevin, Nov 17 and 18; item 8's second stack)

Work in the repo folder on the branch the main session checks out for you (`feat/settings-apply`, stacked on the first
stack's tip, #245; don't switch). You write code and tests and run the checks below. You never commit, push or merge.
Read CLAUDE.md (settings presets, Design) and `src/app/settings/` (SettingsWindow, settingsStore, each tab),
`src/core/storage/settings.ts`, `src/core/model/settingsPreset.ts`, and the Weather units and Plan units settings and
every place they are read (call sheets' forecast, the nearest hospital's distances, plans' lengths).

## What Kevin decided, word for word

Nov 17 note, item 2: "An 'Apply changes' button in Settings, replacing 'settings apply at once'. One Settings milestone
with the Measurement system.
- A changed setting waits until Apply. Beside it, a way to discard what isn't applied.
- Closing Settings with changes waiting asks whether to apply or discard.
- Presets keep working: applying a preset is still one action with its 'Before [name]' copy.
- Say which settings, if any, must still apply at once, and why."

Nov 18 plan, item 10: "Today there are two separate settings: Weather units (By region, Metric, US), which also sets the
nearest-hospital distances, and Plan units (By region, Metres, Feet). No quick switch by the scale bar (the scale bar
is the zoom reset). Neither is in a settings preset (the never list). As Kevin answered:
- Measurement system: By this computer's region, Metric or US. It sets plan lengths (m or ft), weather (°C and km/h, or
  °F and mph) and distances (km or mi) together.
- The two settings stay beneath it, for mixed cases. Measurement system reads By region, Metric or US when they agree,
  and 'Mixed' when they don't, with both shown.
- A quick m | ft switch by the plan's scale bar: plans only, this computer's; it sets Plan units, so Measurement
  system may then read Mixed. Flipping a plan to feet never changes the forecast.
- Upgrading changes nothing anyone sees: whatever a computer shows today, it shows after. No rule makes one setting
  follow the other.
- A plan's Export has Units on paper, defaulting to this computer's plan units; the printed scale bar can show both
  (metres and feet, one above the other).
- Unchanged: the file always stores metres, lenses are always in mm, units belong to the computer, never the project
  (and stay in the presets' never list)."

## How to build it

1. **Apply changes.** Every setting in the Settings window is edited as a draft; nothing reaches this computer's
   settings until Apply. "Apply changes" and "Discard changes" sit in the window's header (beside Save preset…), shown
   active only while a draft differs; closing the window (its close button, Escape, a click outside if that closes it)
   with a draft waiting asks: Apply, Discard, or keep editing. Applying a preset stays one action with its "Before
   [name]" copy (it replaces any draft; say how you handle a draft waiting when a preset is applied). List every
   setting that must still apply at once, and why (for example the project's own fields in the Project tab are project
   edits through ops, not settings: they keep saving at once and undo as edits; say exactly which tabs and fields).
2. **Measurement system** in Settings → App: By this computer's region, Metric or US, setting Plan units and Weather
   units (which also gives distances) together; beneath it the two settings for mixed cases; it reads "Mixed" when
   they disagree, both shown. It is a computer setting, never a preset's (add it to the never list; the test that
   every setting is in the list or the never list must pass).
3. **Upgrading changes nothing anyone sees**: a computer with saved Weather and Plan units keeps them; Measurement system
   is worked out from them, never stored over them.
4. **m | ft by the plan's scale bar**: a quick switch, this computer's, setting Plan units only (a plan setting,
   applying at once as a canvas view does, like the Dark view: say so in the list for item 1).
5. **Units on paper** in a plan's Export: default this computer's plan units; the printed scale bar can show both
   (metres and feet, one above the other).

Every word through `t()` in en and es (Spanish in the file's own voice); list them.

## Tests

Unit: drafts (a change waits; Apply writes; Discard drops; a preset with a draft waiting); Measurement system's reading
(each pair of units; Mixed); upgrading (saved units kept); the never list; the scale bar's switch; Units on paper and
the two-line scale bar. End to end: change a setting, close: the ask; Apply; Discard; the Measurement system sets both;
the m | ft switch; an export with feet on paper. No existing assertion changes except ones that state that a setting
applies at once (list each; stop and report if any is more than that).

## Pictures

`e2e/visual.spec.ts`'s Settings pictures will change (the header's buttons, the App tab): don't touch the baselines;
say which you expect to change. The main session regenerates them with the stack.

## Rules

Nothing stored in the project changes. No new dependency. Don't touch CLAUDE.md, docs/PLAN.md, docs/HANDOFF.md,
`.github`, `.claude`. No prettier.

## Checks

`npx tsc --noEmit`; `npx eslint` on the touched files; unit tests of the folders you touch
(`node test-results/build627b/vitestUpper.cjs <folders>`); end to end, alone, counts read from the output: the
settings, presets, plan export and call sheet specs you touch and any new spec, `--project=chromium --workers=4`. Logs
under `test-results/settings-apply/`. Never start a command with `python`. Nothing fetched through npx.

## Report back

The list of settings that still apply at once and why; what Apply and Discard do in each case; the new words in en and
es; each test's name and result; each changed expectation; each check's output line with counts; the pictures you
expect to change.
