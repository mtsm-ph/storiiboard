# Phase 4 decisions (asked Nov 9, 2026; answered by Kevin Nov 9)

One page. Each decision gives the question, what was weighed, and Kevin's answer, which is what gets built. The plan
is in `docs/PLAN.md`, "Phase 4 milestones". Kevin's go: 4.0, then 4.1 to 4.8 as planned with these answers, then 4.9
and 4.10, stopping at the gate. Approved with it: SunCalc, qrcode-generator, the time-zone table, and three hosts on
net.rs's list (the service switch file's, `api.met.no`, `tile.openstreetmap.org`), each with its rule. Anything else
new, or any other change to existing data, waits for him.

| # | Question | Weighed | Kevin's answer |
|---|---|---|---|
| 0 | Can a service's operator stop or move what the app asks of them without a software update? | Nominatim requires that the service can be switched at its request without an update; the OSM tile policy says services seeking donations may lose access at any point; MET Norway asks heavy users for a caching proxy. | **4.0, a service switch**: a small JSON file in this repo, read through net.rs at most once a day and only just before an online service is used. It can turn a service off (with a message where the service is used) or move it to another server already on the code's list; it can never add a host. Unreadable: the last copy, then the defaults in code. Settings lists every online service the app may contact, what for and when. The README has a section for service operators (what each is used for; reach us through GitHub issues). Tests use a fixture, never GitHub. |
| 1 | Where does the weather come from on a paid shoot? | Open-Meteo's free API is non-commercial only, its paid plan a publisher's key; MET Norway's Locationforecast is free for any purpose, paid apps included, worldwide, CC BY 4.0, with an identifying User-Agent, coordinates cut to 4 decimals and no repeat before `Expires`; the US National Weather Service is free but US only, 7 days. | **MET Norway everywhere** (CLAUDE.md's weather rule changes). Units by region (°F and mph in the US, °C and km/h elsewhere), with an override in Settings. The sheet says when the forecast was fetched. A new forecast doesn't count toward "Changed since issued": the rain check covers that. NWS alerts: later. |
| 2 | How is the nearest hospital found? | Nominatim (on the list already), Overpass (its public server asks commercial apps not to rely on it), Google Places with the person's key, or by hand. | **Nominatim, and by hand; never Google**: Places results can't be shown with a non-Google map, and only coordinates may be kept, for 30 days, where the app needs both. Hospitals OSM marks with an emergency department come first; beside the others, a note to check for a 24-hour emergency room. The safety box prints the emergency number for the location's country (911 in the US and Mexico, 112 across most of Europe) from a table in the code, editable. |
| 3 | Sun times offline: which code? | SunCalc (BSD-2, named in CLAUDE.md) or NOAA's formulas of our own. | **SunCalc**, with the proposed angles: golden hour while the sun is between 6° above and 4° below the horizon, blue hour from 4° to 6° below. |
| 4 | A map on the printed call sheet? | No image (address, coordinates, link, QR) now, or a map image once the map is decided. | **No image now, with qrcode-generator** (4.6); the map image comes in 4.10. The QR and Copy map link open directions in the app chosen in Settings: Google Maps (the default: it gives directions on iPhone and Android), Apple Maps or OpenStreetMap. It's a link only; the app itself never contacts Google. |
| 5 | What does a call sheet keep, and what does it read live? | Everything live, or live while drafting with issuing keeping the PDF as sent. | **Live while drafting; issuing keeps the PDF as sent** and locks the day's shot numbers in the same step, then "Changed since issued". Each issued PDF prints its version and issue time in the header, with "Revised" from version 2. |
| 6 | Whose times does it hold? | One crew call, or overrides per department and person, with cast and HMU times. | **Overrides of the day's crew call** per department and per person; cast call, HMU ready and on-set times. |
| 7 | Which time zone? | This computer's, or the location's. | **The location's**, from a small offline table, never a lookup service, editable on the location. The table: `tzf-rs` on the Rust side (Kevin, Nov 10, in place of `@photostructure/tz-lookup`; MIT, pinned at 2.1.3, its data crate `tzf-dist` at 0.0.2026-e, about 2.7 MB); its zone shapes come from timezone-boundary-builder (OpenStreetMap data, ODbL, credited under the field), and near borders in sparse areas it can be wrong, which the edit covers. |
| 8 | Paper size | Letter, A4, or by region. | **By this computer's region**, with a choice in Export. |
| 9 | Who is on a day's call sheet? | Everyone in Cast and crew, or those added to the day. | **Those on the day**, with "Add everyone". Phone and email print only where the person's record allows it: on by default for crew, off for cast. |

Also answered Nov 9 (built before Phase 4):
- **The map (4.9)**: react-konva, tiles fetched through Rust with a disk cache. OpenStreetMap's tile policy applies:
  the app's User-Agent, the credit always visible, cache headers honored (7 days if there are none), only the tiles
  being viewed, never a download for offline. A tile provider of one's own, set in Settings, adds that one host, and
  Settings says so where it's set. The pin can be dragged to where the crew should go (an entrance, a basecamp),
  which saves the location's place. 4.10 puts the map image on the call sheet from the tile cache, with the credit.
- **3.18, approvals**: T-stop, support and height count for camera and grip-electric; the scene's characters count
  for every department. An approval that was current before an upgrade stays current after it: neither a format
  upgrade nor a change to the rule may show "Changed since approval" (3.13's case fixed, with a test, clearing the
  false ones on files already upgraded where that can be done).
- **3.19, failed tests**: the name of every failed test is saved (Playwright's retries report flaky tests; Vitest
  writes a JSON or JUnit report; both kept as CI artifacts) and listed in each report. If grab-a-still fails again, its
  cause is found before going on.
- Kept as they were: 3.12's Protected View on opened PDFs, 3.16's focus views counting only one's departments.
