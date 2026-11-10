# Storiiboard

Storiiboard is an open-source pre-production tool for filmmakers, producers and content creators. It's built around
fast storyboarding: every shot links to its scene, location, shoot day, people and gear, and the schedule, call sheets,
gear lists and bird's-eye plans come out of the storyboard.

- **Desktop app** (Mac and Windows, built with Tauri): where the production is planned. It works offline, and each
  project is one `.sbd` file you keep.
- **Web companion** (planned): cast, crew and clients view the boards and call sheets, comment, suggest and mark
  availability.
- **MCP server** (planned): AI assistants read a project and propose changes, which a person approves.

## Status

Storiiboard is early and in active development. Files and features change from week to week, and it isn't ready for
real productions yet. [docs/PLAN.md](docs/PLAN.md) has the current phase and what's next.

## Running it

You need Node 22.18 or later and Rust (stable).

```sh
npm install
npm run tauri dev   # the desktop app
npm test            # unit tests (TypeScript and Rust)
npm run e2e         # end-to-end tests in Chromium and WebKit
```

## License

There's no license yet. One will be chosen before the first release.
