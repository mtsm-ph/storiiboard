# Alpha test (by hand)

What to try by hand in the installed app, by feature, in the order a production uses it: one pass, when the alpha is
fully built. It starts from the by-hand checklists of Phases 1 to 6 (docs/HANDOFF.md, docs/PLAN.md,
docs/DESKTOP_GAPS.md); every milestone adds its own items here. Each item is an action and what should happen, with
its milestone in parentheses. Items the docs record as already checked and closed are left out.

Marks: **[Kevin]** is a judgement only you can make (feel, look, print, colour). **[Mac]** and **[Windows]** need that
system's installed app; an item with neither works on either, and is worth doing on both where it says so.
**[Other PC]** needs a computer that isn't one of Kevin's two (Windows 10, a PC without WebView2, an N edition, a
mid Windows laptop, a managed PC): those are set apart at the end, so the main pass doesn't wait on them.

## Install and first open

- [ ] [Windows] Install on Windows 11: the app opens and its window, title bar and scaling look right. (Phase 8)
- [ ] [Mac] Install on macOS 13 or later on Apple silicon: the app opens. (Phase 8)
- [ ] [Mac] [Windows] Double-click a .sbd with the app closed, then with it running: the project opens; on Windows a
  second launch hands its file to the window already open. (0.6)
- [ ] [Kevin] Double-click a .sbd: the window can show a flash of the wrong background before the page loads; say if
  it bothers you. (DESKTOP_GAPS A2)
- [ ] [Windows] Force-quit mid-edit and reopen: the edit is there, and ⌘Z (Ctrl+Z) after the restart still undoes it.
  Phase 0 ran these on the Mac only. (Phase 0)
- [ ] With Documents in iCloud Drive, OneDrive, Dropbox or Google Drive: New project says so once and starts in a local
  folder; opening a project from a synced folder says so once. (1.3)
- [ ] Open a project on one computer, then try the same file on the other: the second warns which computer has it
  open (the lock file). (1.2)
- [ ] With a synced project open on one computer, let a sync replace the file (an edit made on the other computer
  while this one was closed): the app stops writing and reopens the new version; nothing is lost. (1.2)
- [ ] [Mac] [Windows] The workers' own policy (src-tauri/worker-csp.txt), in a debug build, which has the web
  inspector (a release build has none): `npm run tauri build -- --debug`, then open the app it builds. Import script…
  with a PDF screenplay, and choose a project's key image. In the inspector's Network panel (Edge DevTools on Windows,
  Safari Web Inspector on the Mac), select `pdf.worker.min-*.mjs` and the theme's `worker-*.js`: each one's Response
  Headers show `Content-Security-Policy: default-src 'none'; script-src 'self'; worker-src 'self'; base-uri 'none'`.
  The PDF's scenes are still read, and the key image's colours are still offered. (`npm run tauri dev` serves the
  page from Vite, not from the app, so it can't show the header.) The launch check reads the same header and runs
  both workers in the app just built at every checkpoint (6.27l), so this is a second look by eye, no longer one only
  Kevin can give. (worker CSP)
- [ ] [Mac] [Kevin] The launch check, strict, on a real Mac, with no build tools: download a checkpoint's Mac
  installer (the `storiiboard-macOS` artifact), clear its quarantine flag, mount it and start the app inside with
  `STORIIBOARD_LAUNCH_CHECK=1` (the three Terminal lines are in the report of the run they belong to). It prints
  eight lines and quits by itself. `launch check: accents ok` with nothing after it, then `launch check: passed`: the
  accent reader's worker reads on a real GPU. `accents ok (by the page: …)`: the worker fails on a real Mac too and
  the page stands in for it; send the line. (6.27r)

## Project, files, backups, History and Trash

- [ ] [Mac] [Windows] Edit for more than 5 minutes: a backup `<Project> YYYY-MM-DD HH-mm.sbd` appears; Settings →
  Backups → Show backups shows its folder (never run on either system). (6.15)
- [ ] [Mac] A fresh backup takes almost no space (an APFS clone). [Windows] A backup is a full copy and no edit waits
  while it is written. (1.4)
- [ ] A project in a synced folder keeps its backups in a local folder; the setting puts them next to the project.
  (1.4)
- [ ] Open backup: the copy opens as a separate project and the original is untouched. (Phase 0)
- [ ] The status bar reads "Saved 14:32 · Backup 14:30" and a click opens Settings → Backups. After travel to another
  time zone the backup time can be off until the next backup. (6.5.4)
- [ ] Open a real project from before Phase 6, and a Phase 2 one with frame approvals: a backup is written first, the
  file reads the current schema, no "Changed since approval" or "Changed since issued", day numbers as they were.
  (3.6b, 3.18, Phase 6)
- [ ] After that upgrade: a scene where every frame was approved shows the department approved by the same person;
  History shows the upgrade as one step; ⌘Z stops at it; Restore to here still reaches before it, and ⌘Z undoes the
  restore. (3.6b)
- [ ] [Mac] The Phase 1 basics, which passed on Windows: History's restore and an old value, a named version opened as
  a copy, Trash filters and Restore, Empty Trash, Settings → Storage → Compact project. (1.20 to 1.27)
- [ ] Notifications: make edits as someone else (switch This is me), switch back: the status bar's count opens the
  tile; All, Unread, This scene, Mark all read; quit and reopen, still read; your own steps never count. (3.10)
- [ ] Export → Project data (JSON) and Full archive, then Import project data… on the Projects screen: everything back,
  PDFs too, the Trash and History in the archive, undo works. (2.9, 3.14)
- [ ] Import a project made by an older build on the Mac: its pictures open as they were. (6.27b)
- [ ] [Kevin] The same with your largest board on the Mac and on Windows: how long each takes, and whether the app
  strains. (2.9)
- [ ] Your workspaces: save one from the Layout menu; rename, duplicate and delete in Manage workspaces…; it is there
  in another project and not on the other computer. (3.6d)
- [ ] Assets: attach PDFs (a location contract, a release) and links to the project, a scene, a frame, a location and
  a person; a non-PDF and one over 50 MB are refused; a rename with a folder or a leading dot is refused. (3.11)
- [ ] [Mac] [Windows] Open a PDF and a link from Assets; on Windows, Acrobat opens the PDF in Protected View; Save a
  copy… works. (3.12)
- [ ] [Mac] Assets → Copy link, then paste somewhere: the link is there. (DESKTOP_GAPS B2)
- [ ] Trash a PDF on a frame that has a picture, restore it: it comes back as itself and the picture is untouched;
  Empty Trash asks first. (3.11)

## Script import

- [ ] Import your real script as Fountain, Final Draft (.fdx) and PDF: the preview shows its scenes; scenes,
  locations and characters are made; scene numbers match the script. (1.17, 1.18)
- [ ] [Mac] The PDF above on the Mac above all: before 6.27p the Mac app could not read any PDF (its webview lacks a
  feature pdf.js used; every test passed because Playwright's WebKit has it). The launch check now reads a small PDF
  in the built app at every checkpoint; a real screenplay is still worth one look. (6.27p)
- [ ] A Spanish script: INT./EXT. headings in Spanish read as scenes. (P7)
- [ ] [Kevin] The Phase 1 gate: board a real scene in one sitting, from script import to finished frames, and export
  it as a PDF. (Phase 1)

## Storyboard

- [ ] [Kevin] Export a storyboard PDF of a 9:16 project and print a page: frames, numbers and notes read well on
  paper. (1.25)
- [ ] [Kevin] Drop an iPhone photo (Display P3) on a frame: its colour on the card matches the Photos app. (1.10)
- [ ] [Windows] Drop a picture from Explorer onto the storyboard while a plan is open beside it: it lands on the frame.
  (Phase 6)
- [ ] Approvals: only the director or the DP can approve a department for a scene (try as someone else); change a lens,
  sketch, picture or notes and the scene shows "Changed since approval"; approving again clears it; attaching a PDF
  changes nothing; Priority, Seen, Working on it and Done stay per frame. (3.6b, 3.15)
- [ ] Each scene heading shows how many departments are approved, and a dot when one changed since. (3.16)
- [ ] A department's name in the Inspector opens its workspace, listed in the sidebar until taken off. (3.6a)
- [ ] The Inspector's Shoot day row: a frame in a day shows "Day 2 · date" and opens Shoot days on it; a frame in none
  reads "Not scheduled". (5.11)
- [ ] [Mac] Shift+F10 on a frame opens its menu. [Windows] The Menu key on a frame shows only the app's menu. (6.19)

## Video and the Player

- [ ] [Windows] A real FX3 clip on a PC with a GPU: the playback copy starts on its own, and Task Manager's GPU "Video
  Encode" graph rises while it is made. (2.3a)
- [ ] [Mac] A long take on an external drive; unplug the drive halfway through its copy: the Inspector says it failed,
  with Try again, and the copies' folder holds nothing of it. (2.3a)
- [ ] [Mac] [Windows] A clip on a network share; cut the network halfway through its copy: after about a minute and a
  half the Inspector says the video stopped being read partway, with the drive's advice, and never that the encoder
  stopped responding (those words are for an encoder that hangs while the file still reads). (6.27m)
- [ ] A Sony FX6/FX9 or Canon MXF with separate mono tracks: both channels in the copy, the empty inputs left out, never
  clipped; a clip with every input empty says it has no sound. (2.3b, 2.3c)
- [ ] [Mac] [Windows] The Player with real footage: plays, scrubs and steps without stalling; comma and period land on
  the frame the timecode says (compare with Resolve); I and O set in and out, ⌘Z takes each back. (2.4)
- [ ] Play a take to the end: it stops on its last frame, O there sets the out point on it; Space replays from the in
  point. (2.4)
- [ ] Settings → Storage: free space roughly as Finder or Explorer shows it; Licences… shows each file's text; Move to
  another drive… and Move back; Clear… while a copy plays (the Player offers Make playback copy), then the Inspector
  says "No playback copy yet." (2.3b, 2.4)
- [ ] Forget remembered videos…: a video outside its project's folder then shows as missing, with Relink. (2.3b)
- [ ] Relink a frame's video while its copy is being made, then undo: the copy shown is of the file the frame points
  at. (2.4)
- [ ] [Kevin] A camera maker's LUT (S-Log3 or LogC to Rec.709) on log footage: compare a frame with Resolve under the
  same LUT; undo takes it off. A Resolve "Shaper + 3D" .cube is refused with words that say why. (2.5)
- [ ] [Kevin] HLG or PQ footage under its own camera LUT: the grade looks right. (2.5)
- [ ] [Kevin] Framing: zoom and move the frame's window over a take, by hand and with the keys: it should feel like a
  frame-line overlay on a monitor; each move is one ⌘Z; try 2.39 and 9:16 over 16:9 footage. (2.6)
- [ ] The Phase 2 gate: frame a shot on your own footage, step to the moment, press G: the frame's picture is that
  frame, framed and graded, in a second or two, "Still at <timecode>" matching Resolve; ⌘Z takes it back; a 6K or 8K
  original too. (2.7)
- [ ] Save clip as file… with in, out and framing set: in Resolve or Premiere the MP4's first and last frames are the
  in and out, framed, graded, sound in sync; from an external drive and from a 6K or 8K original too. (2.8b)

## Locations

- [ ] [Mac] Search address on a location: results after the press only, picked one cached; in Spanish, names in
  Spanish. (3.4)
- [ ] The map: click it first, pan and zoom (Ctrl/⌘ + wheel always zooms), drag the pin, ⌘Z. A fast wheel from 16 to
  10: in the cache folder's tiles/osm, no zoom 11 to 15 tiles keep arriving once you stop. (4.9)
- [ ] Paste coordinates copied from Google Maps onto a location: its place is set with no request, shown to 5
  decimals. (6.5.5, 6.25)
- [ ] Add JPEG scout photos taken with location on: each keeps its date, time and place; the status line says what
  was read; make one the location's light reference. (6.27)
- [ ] [Mac] Add an iPhone HEIC photo: it imports, and the status line says its date and place can't be read yet and a
  JPEG copy works. (6.27)
- [ ] [Windows] Add your own iPhone HEIC photos: note what happens (the webview may not decode them; the old notice
  shows). (6.27)
- [ ] [Kevin] A location photo from an iPhone: its colour matches the Photos app. (3.3b, 6.27)
- [ ] [Mac] [Windows] Add a scout photo taken with location on, then Export → Project data (JSON): the stored
  picture and its thumbnail carry no date, time or place, only the picture and its colour profile. (6.27b)
- [ ] Copy map link and the QR open directions in the app chosen in Settings (Google Maps, Apple Maps, OpenStreetMap);
  [Mac] the copied link pastes. (4.6, DESKTOP_GAPS B2)

## Cast and crew, characters

- [ ] The Phase 3 gate: enter a real shoot's people, places and gear; characters linked to who plays them; pick
  yourself as This is me. (3.5a to 3.5c)
- [ ] Full view is on for the director and the DP, off for everyone else; as a gaffer, grip and electric comes first
  on frame cards, the Inspector and the shot list, other departments (approvals too) fold under Rest of crew. (3.6c)

## Gear, camera bodies and lenses

- [ ] Enter your real kit: quantities, owned or rented and from whom, day rates in the project's currency written as
  your region writes money, and a currency without cents (yen). (3.9a)
- [ ] Build each day's gear list and give frames their gear: a frame needing gear its day lacks shows a warning in
  the Inspector and the day lists it; Have and Source frames are never flagged. (3.9b)
- [ ] A body from the sensor table and a lens you own on a frame: the Inspector's field of view is what you expect for
  that lens. (6.1)

## Shoot days and Calendar

- [ ] Make the days for a real shoot; move Need-to-shoot frames a scene at a time and one by one (each one ⌘Z).
  (3.7)
- [ ] [Kevin] The totals (frames, setups, hours at your minutes per setup) against your own estimate. (3.7)
- [ ] [Mac] Half-clear a day's date: the day keeps its date. (3.7)
- [ ] Calendar month and week: picking a day narrows the schedule list; each day shows its scenes, its location's
  status and "1 of 3 confirmed"; toggle Confirmed per person. (3.8)
- [ ] The week starts as this computer's region says, in English and Spanish; Settings → App overrides it. (3.17)
- [ ] [Mac] VoiceOver reads the Calendar's date cells correctly. (3.8)

## Call sheets

- [ ] [Mac] [Windows] The Phase 4 gate: a real shoot day's sheet end to end (who's on it, calls, cast times,
  contacts), Export PDF, then Issue; open the issued PDF in Preview and in Acrobat or a browser. (4.1 to 4.7)
- [ ] Issue again after an edit: "Changed since issued" before; version 2 prints "Revised" and its issue time; a new
  forecast alone doesn't count. (4.7)
- [ ] Who's on the day: a new day starts empty; Add everyone; a time typed on a person stays theirs when the
  department's call changes; ⌘Z inside a time field. Phone and email print only where the person allows. (4.2)
- [ ] Mark a frame Have: it leaves the sheet; the Calendar still lists its scene. (4.11)
- [ ] The forecast for a location a few days out: fetched once, "Up to date until …" on Refresh, the MET Norway
  credit; Settings → App → Weather units. (4.4)
- [ ] Sun times at a place far from your time zone (pick a zone on the location), and Reykjavík in June: merged golden
  and blue hours, with +1. (4.3)
- [ ] Find nearest hospital, pick one: the safety box shows Emergency or Ambulance and the number; type another name
  over it and the 24-hour line and distance go. (4.5, 4.13)
- [ ] The checks strip: a cast member with HMU ready 20 minutes after call; a location missing parking; a DAWN scene on
  an overnight day (18:00 to 08:00) is not flagged. (4.8)
- [ ] The map on the sheet, on screen and in the PDF, with its credit. (4.10)
- [ ] Attach a company with a logo in Settings to a project: its name and logo head the sheet. (4.12, 5.12)
- [ ] [Kevin] The logo's colours on the printed sheet match the logo file. (4.12)
- [ ] [Mac] The call sheet tile and its PDF; a half-typed time in a time field keeps its value. (Phase 4)

## Moodboards and decks

- [ ] [Mac] [Windows] The Phase 5 gate: a real pitch deck in under an hour: New deck → Pitch or Lookbook, edit,
  Present, Export as PDF; open the PDF in Preview and Acrobat. (5.5, 5.6a)
- [ ] [Mac] [Windows] Adobe Fonts you've activated appear under "On this computer" after a relaunch; a brand font
  prints as selectable text; a font whose licence forbids embedding falls back and the export says so. (5.1a, 5.6a)
- [ ] A deck PDF with Outfit Bold, Archivo Light Italic and Jost at several weights: each prints in its own face and
  weight, with no notice. (5.10)
- [ ] [Kevin] A large Bodoni Moda title, screen against PDF: the PDF's is about 2% wider with less contrast. (5.10)
- [ ] [Kevin] Drop iPhone (P3) photos on a board and export the deck: pictures print from their originals and their
  colours match. (5.1b, 5.6a)
- [ ] Move an original away and export again: the notice counts the stored copy; in a OneDrive project, originals
  still print. (5.6a)
- [ ] [Kevin] Deck pages at 9:16 and 4:5 exported to PDF and printed: how they sit on the paper. (5.5, 5.6a)
- [ ] [Mac] ⌘C/⌘V on a board; a screenshot pasted onto a board; ⌘C on the board then ⌘V in TextEdit gives the items'
  words. (5.0, 5.1b)
- [ ] [Mac] Right-click a board item and choose Duplicate: it is duplicated. (6.19)
- [ ] [Mac] Show in Finder / [Windows] Show in Explorer on a dropped picture: its original shows selected, never
  opened; move it away and the action goes. On the Mac, an original in Desktop or Documents: note whether a folder
  prompt appears. (5.9)
- [ ] [Windows] Drag a page by its ≡ handle in a deck's Pages panel: it moves. (DESKTOP_GAPS B1, 6.15)
- [ ] Live cards: a shot card follows the frame's lens and size; double-click jumps back; a trashed frame reads "In the
  Trash". (5.4)
- [ ] Connectors, sections, align and tidy, snap guides; quick-create with ⌘⌥→ (Ctrl+Shift+→ on Windows). (5.2, 5.3)
- [ ] [Windows] With two keyboard layouts installed, Alt+Shift+H/V/T don't switch the input language. (5.3)
- [ ] Swatches: a .ase opens in Illustrator, InDesign or Photoshop. (5.6b)
- [ ] Present on a second screen, F for full screen; nothing pressed while presenting changes the project. (5.5)
- [ ] The dot grid: its spacing follows the zoom and is shown; snap to it; Ctrl/⌘ suspends snap while moving; a sticky
  in any colour keeps its words readable. (6.5.7a)
- [ ] Crop a picture with Ctrl (⌘) + a handle; a single selected picture shows 8 handles and a plain drag of a middle
  one keeps proportions; Reset crop; a border on and off; the PDF holds only the kept part. (6.5.7b)
- [ ] [Kevin] A new board's first view is centred on its origin, not fitted: say if it should change. (6.5.2)
- [ ] [Mac] [Kevin] The 500-item board on your Mac: pan, zoom and drag feel smooth. (5.7)
- [ ] [Kevin] The Dark view on a board and a deck: readable, chosen colours and pictures unchanged; the PDF stays on
  paper. (6.5.1)

## Bird's-eye plans

- [ ] The Phase 6 gate, a real setup end to end: a scene's room traced over a floor plan or photo (Set scale with a
  distance you know), walls with typed lengths (try 12' 6"), doors, windows, set pieces; two setups; cameras linked to
  their frames; lights with their gear items and watts, flags and diffusion; cast marks; north and the sun path for
  the shoot day. (6.0 to 6.9)
- [ ] [Kevin] Plan tile → Export… → Setup plan (PDF), the scene's packet and, from Shoot days, the day's; print at
  100% and lay a scale rule on a typed wall (at 1:50 a 4.00 m wall is 80 mm; in feet, 1/4" = 1'-0"); read beams,
  watts, heights, the legend's total, each frame's lens and field of view; then show it to a gaffer. (6.10)
- [ ] [Kevin] A lens you own on a frame: the cone matches what the camera sees in that room; an anamorphic on its side
  if you shoot one. (6.4)
- [ ] [Kevin] For a location and day you know, the sun's direction and height at a time against a sun app or the real
  sky; with no zone on the location and none found, it says "No time zone", never guesses. (6.6)
- [ ] Quick sun: a sun path's own coordinates (pasted) and date on a setup with no location or day; the compass at the
  top right shows north and the sun and opens their settings. (6.5.5)
- [ ] A window in an outside wall: its facing and the hours direct sun can come through, with "Buildings and trees
  outside aren't known". (6.5.6)
- [ ] [Kevin] A setup's light reference switch on, from a scout photo: the sun is drawn from the photo's date, time and
  place, the mark says which place; compare with the shadows in the photo. (6.27)
- [ ] [Mac] Draw, drag from the Library, turn with the handles and with comma and period, copy from the right-click
  menu then paste, paste a screenshot as an underlay, drop a picture from Finder, pinch to zoom, export a PDF; text in
  icons (Parking's P, marks' letters) is in the bundled face. (Phase 6)
- [ ] [Windows] Drag from the Library; reorder setups by drag; drop a picture from Explorer onto the plan. (6.3, 6.0)
- [ ] Drag a wall across a camera's cone and a light's beam: the cut follows live; turn Stop at walls off on one and
  draw a wild wall: the cone passes through. (6.18)
- [ ] A department's print with the watermark on: the room in full, set pieces dimmed except on art's, cameras with
  cones and cast marks dimmed, that department's items in full; the watermark inside the plan box. (6.17, 6.20, 6.22)
- [ ] [Kevin] On that print: is 45% dimmed context too faint for small labels; should a lighting print show the
  camera faintly; a legend's continuation page has no watermark. (6.20)
- [ ] Layers: This is me as a gaffer, a plan with no saved layers: lighting and grip shown, the rest dimmed; solo, hide
  and lock; nothing of it reaches History or the file. (6.8)
- [ ] The Setup section's layout: a saved default becomes the new one (Setups and Layers left, Selection and Library
  right); a layout you changed is kept, new tiles in the Layout menu. (6.9)
- [ ] The tool strip: each button's name and key on hover and on keyboard focus; nothing first shown under it.
  (6.5.2)
- [ ] [Kevin] The icons: their classes (set piece, grip, sound, production), footprint items drawn as true-size
  outlines, symbols at their own size, and how they read on screen and on paper. (6.3, 6.17)
- [ ] [Kevin] The Dark view on a plan: readable, department colours and fills unchanged; PDFs and PNGs stay on paper.
  (6.5.1)
- [ ] [Kevin] Zoom with your own mouse, trackpad mode off: the wheel zooms at the pointer, one notch follows the
  system's step; Ctrl + wheel scrolls up and down, Shift + wheel sideways, ⌘ + wheel as Ctrl. (6.5.3)
- [ ] [Windows] [Kevin] The touchpad: with trackpad mode off (the default) a two-finger scroll zooms; turn it on, and
  two fingers pan and a pinch zooms. (6.5.3)
- [ ] [Mac] [Kevin] Trackpad mode is on by default: two fingers pan, a pinch zooms, on plans and boards. (6.5.3)
- [ ] [Mac] [Kevin] A big plan on your Mac: pan, zoom, drag and a held turn key feel smooth. (6.11, 6.26)

## Settings, presets, themes, Dark view and accessibility

- [ ] [Kevin] A project theme from its logo or key image, in light and dark: the accent and backgrounds look right and
  read well. (1.14, 1.15)
- [ ] With the system's reduced motion on, switching projects changes the theme at once, with no fade. (1.15)
- [ ] Settings presets: save one, change things, Apply…: it shows what will change, saves "Before [name]" first, and
  History says "Saved settings preset Before [name]"; language, units, paper and trackpad mode stay. (6.5.8)
- [ ] [Mac] Settings → Profile: Tab from the last text field reaches the buttons and wraps round the window; Option+Tab
  too, with Keyboard navigation off. (Q3, 6.5.3)
- [ ] [Mac] Settings → Theme: Tab from the Hex field out of the colour panel closes it. (6.19, 6.28)
- [ ] Keyboard only, every screen: every control reachable by Tab, its focus ring ink and never hidden, an in-app
  window keeps Tab inside itself. (Q3, 6.5.3)
- [ ] [Kevin] Spanish, your glossary pass: "Emplazamiento" for a setup (tile "Emplaz."), "Espacio" for a room, the
  icons' names, "Emitir", "Emitida" and "Actualizada" on call sheets. (P7, 4.7, 6.0)

## Online services and network

- [ ] Settings → Online services lists every service, what for and when. (4.0)
- [ ] "Use this server" with a tile server of your own: the system question names the host; Cancel and Escape save
  nothing. (4.9)
- [ ] With the network off: everything but lookups works; the forecast, map tiles and searches say there's no
  connection. (4.4, 4.9)
- [ ] [Mac] [Windows] The installed app's real content security policy header against tauri.conf.json's (Tauri may
  add to it). (6.13)

## On other computers

These need a computer that isn't one of Kevin's two. The main pass doesn't wait on them.

- [ ] [Other PC] Install on a Windows 10 22H2 PC that already has WebView2: the app opens and its window, title bar
  and scaling look right. (Phase 8, Windows 10)
- [ ] [Other PC] Install on a Windows 10 PC without WebView2, online: the installer fetches it and the app opens.
  Once offline too: expected to fail today (an offline installer is a Phase 8 question). (Windows 10)
- [ ] [Other PC] [Kevin] A 300-frame board on a Windows 10 PC with an older GPU: scrolling feels smooth. (Q2,
  Windows 10)
- [ ] [Other PC] On a Windows 10 PC, a playback copy and a grabbed still; on an N edition, only after the Media
  Feature Pack (without it the app says "That video couldn't be made into a playback copy"). (Windows 10)
- [ ] [Other PC] On Windows 10: the forecast and the map tiles load, Export PDF opens. (Windows 10)
- [ ] [Other PC] [Kevin] The 500-item board on a mid Windows laptop: pan, zoom and drag feel smooth. (5.7)
- [ ] [Other PC] A board open on a Windows 10 PC. (Windows 10)
- [ ] [Other PC] [Kevin] A big plan on a mid Windows laptop: pan, zoom, drag and a held turn key feel smooth. (6.11,
  6.26)
- [ ] [Other PC] On a managed PC with root certificate updates turned off: the forecast and the map tiles still
  load. (Windows 10)
