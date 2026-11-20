# Frame reports

What the webview reported for each frame callback in e2e/player.spec.ts › "a page too busy to see every frame…
(2.8)", as the test attaches it (`frame-reports.json`): the clip's In 10 and Out 20 at 24000/1001, the count the spec
made then (`seen`, from `presentedFrames` where the engine gave it) and the raw values. Only the test clip's frame
times and counts: no person, no path, nothing from a project. Copied unchanged from the checkpoint runs' attachments;
e2e/frameCount.test.ts reads them.

| File | Checkpoint run | Engine | Machine |
|---|---|---|---|
| nov19a-webkit.json | nov19-a | WebKit | GitHub's Mac |
| nov19b-webkit.json | nov19-b | WebKit | GitHub's Mac |
| nov19c-webkit.json | nov19-c | WebKit | GitHub's Mac |
| nov19c-chromium.json | nov19-c | Chromium | GitHub's Linux |
| nov20a-webkit-try0.json | nov20-a, first try | WebKit | GitHub's Mac |
| nov20a-webkit-try1.json | nov20-a, retry | WebKit | GitHub's Mac |

These files' `seen` is the old count, from `presentedFrames`; attachments from this change on carry the new count
(e2e/frameCount.ts); `raw` rebuilds either.

The nov20-a pair already carry the new count in `seen`. These two failed when they ran, with "frame 22 reported after 1
missed (1 allowed in this run)", and pass with the turn's lateness counted (`lateness` in e2e/frameCount.ts).

The four nov19 files passed when they ran. In the WebKit ones `presentedFrames` rises less than the media time jumps on 3, 5 and 5
steps (it leaves out frames WebKit drops); in the Chromium one the two agree on every step.
