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

## For service operators

Storiiboard asks these online services for things, and nothing else, only when a person asks it to:

- **Nominatim** (nominatim.openstreetmap.org): the address search in the Locations tile. One request when someone
  presses Search address, and the nearest hospital (one or two requests, on a press of Find nearest hospital), at most one
  request a second, and every answer is cached in the project.
- **MET Norway** (api.met.no): the forecast for each location on a call sheet (Locationforecast 2.0). One request when
  a call sheet is opened on a day or its Refresh is pressed, for a place with coordinates cut to 4 decimals, never
  again for that place before the answer's `Expires`, and every answer is cached in the project. Data from MET
  Norway, CC BY 4.0.
- **OpenStreetMap tiles** (tile.openstreetmap.org): the map on a location. Only the tiles of the map being viewed, never
  more than 2 requests at a time, never a bulk or offline download, zoom 0 to 19. Each tile is kept on the computer for
  as long as the response's cache headers say (7 days when it has none), then renewed with `If-None-Match` and
  `If-Modified-Since`. The map always shows "© OpenStreetMap contributors". A person can point the app at a tile
  server of their own in Settings instead, and then OpenStreetMap's isn't contacted for tiles.
- **The service list** (raw.githubusercontent.com): `services.json` in this repository, read at most once a day and
  only just before one of the services above is used.

Every request says `Storiiboard/<version> (+https://github.com/mtsm-ph/storiiboard)` as its User-Agent, and nothing
about the person. If you run one of these services, you can have the app's use turned off, or moved to another of the
servers it already knows, without an update: the service list is that switch. Reach us through
[GitHub issues](https://github.com/mtsm-ph/storiiboard/issues) on mtsm-ph/storiiboard.

## License

There's no license yet. One will be chosen before the first release.
