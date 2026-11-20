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

These files' `seen` is the old count, from `presentedFrames`; attachments from this change on carry the new count
(e2e/frameCount.ts); `raw` rebuilds either.

All four passed when they ran. In the WebKit ones `presentedFrames` rises less than the media time jumps on 3, 5 and 5
steps (it leaves out frames WebKit drops); in the Chromium one the two agree on every step.
