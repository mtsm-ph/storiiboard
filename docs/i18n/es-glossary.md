# Spanish (Latin America) glossary

For Kevin to review. Polish 7 merged with every choice as built (Kevin, Nov 5); his changes come as a small follow-up PR. The translation is in
`src/core/i18n/locales/es.ts`; every choice below is a word or two there, so changing one is a one-line edit.
Stored values never change with the language: a project saved in Spanish opens the same in English, and file names
other tools rely on (`SC004_4A.png`, backups, opened copies) stay as they are.

## Choices to make

| # | Choice | Built as | Other option | Where |
|---|---|---|---|---|
| 1 | **Shot size abbreviations** | Spanish: GPG, PG, PM, PMC, PP, PPP, INS | English, as many bilingual US crews use: EWS, WS, MS, MCU, CU, ECU, INS | `shotSize.*` (7 lines) |
| 2 | Formal or informal "you" | tú ("Elige otro nombre") | usted ("Elija otro nombre") | every sentence that addresses the person |
| 3 | A storyboard **frame** | cuadro ("+ Cuadro", "3 cuadros") | viñeta | `count.frames`, `board.*`, many others |
| 4 | The **Setup** section (bird's-eye view) | Planta | Emplazamiento, Vista aérea | `workspace.setup`, `tile.plan.*` |
| 5 | **Cast** | Elenco | Reparto | `department.cast`, `role.cast` |
| 6 | **DP** (approvals, "Director and DP") | DF (director/a de fotografía) | DP | `approver.dp`, `approver.dpInSentence` |
| 7 | **Roles**, kept free of gender | by function: Dirección, Dirección de fotografía, Producción, Dirección de arte, Edición | Director/a, Productor/a… | `role.*` |
| 8 | Shot status **Source** | Archivo ("2 de archivo") | Conseguir: doesn't fit the inspector's status button; would need it widened | `shotStatus.source`, `board.counts.source` |
| 9 | Shot status **Have** / **Need to shoot** | En mano / Por filmar | Tenemos / Falta | `shotStatus.*`, `inspector.need`, `board.counts.*` |
| 10 | **Move** field label | Mov. ("Movimiento" doesn't fit the inspector's column) | Movimiento, with a wider column | `field.move` |
| 11 | Department status **Done** | Listo | Hecho, Terminado | `departmentState.done` |
| 12 | **Color script** tile | Guion de color | Color script | `tile.colorScript.title` |
| 13 | Kept in English, as crews say them | Storyboard, Moodboard, T-stop, gaffer, key grip, dolly, slider, gimbal, steadicam, zoom in/out, tilt | Guion gráfico, tablero de referencias… | various |
| 14 | Scene label on screen | ESC 04 (slate numbers unchanged: 4A, 4B) | SC 04, as in English | `scene.label`, `importScriptDialog.sc` |
| 15 | **Gear** (Phase 3 tile) | Equipamiento, so "Equipo" means only the team | Equipo técnico, Material | `tile.gear.title` |
| 16 | A scene's **length** in pages | Extensión ("1 3/8 pág") | Duración (reads as screen time), Páginas | `field.length`, `inspectorView.length` |
| 17 | Shorter tile names, to fit a narrow tile's title bar | Inspector (Frame inspector), Íconos (Library) | Inspector de cuadro, Biblioteca, if the tiles are wider | `tile.inspector.title`, `tile.library.title` |
| 18 | MAÑANA and TARDE in script headings | kept as written, like CONTINUO | read as DÍA | `TIMES` in src/core/script/script.ts |
| 19 | Custom fields | Campos personalizados (and "campos fijos" for the frame's own) | Campos propios | `inspectorView.customFields`, `field.builtIn` |

Not a translation, but for Spanish users: the shot list CSV is separated by commas. Excel set to Spanish in much of Latin
America expects semicolons and opens it as one column (File → Import works either way). Changing the separator by
language is a small change; say if you want it.

## Film vocabulary used

| English | Spanish (Latin America) |
|---|---|
| call sheet | hoja de llamado |
| call time / crew call | llamado / llamado general |
| shoot day | día de rodaje |
| slate | claqueta |
| scene / shot / setup | escena / plano / emplazamiento |
| wide shot / medium shot / close-up | plano general / plano medio / primer plano |
| extreme wide / medium close-up / extreme close-up / insert | gran plano general / plano medio corto / primerísimo primer plano / inserto |
| lens (mm) / focal length | lente (mm) / distancia focal |
| golden hour | hora dorada |
| location | locación |
| INT / EXT, DAY / NIGHT / DAWN / DUSK / MAGIC HOUR | INT / EXT, DÍA / NOCHE / AMANECER / ATARDECER / HORA MÁGICA |
| sticks, handheld, crane, car | trípode, cámara en mano, grúa, vehículo |
| push in / pull out / track / follow | acercamiento / alejamiento / travelling / seguimiento |
| ground / eye / overhead (height) | piso / ojos / cenital |
| Departments | Dirección, Cámara, Grip y eléctricos, Arte, Maquillaje y peinado, Vestuario, Sonido, Producción, Posproducción, Elenco, Cliente |
| Department status | Prioridad, Visto, En proceso, Listo, Aprobado |
| Trash / History / Undo / Restore | Papelera / Historial / Deshacer / Restaurar |
| backup | respaldo |
| tile / layout / workspace | panel / disposición / espacio de trabajo |
| palette / swatch | paleta / color |
| sketch / note | boceto / nota |
| PDF page size | carta (US Letter) |
| export names | lista de planos de Bey County ESC 04.csv, storyboard de Bey County.pdf, cuadros de Bey County |

## Script import

Spanish scripts are read by the same rules, in addition to the English ones:

- INT. and EXT. as in English, or spelled out in capitals: INTERIOR, EXTERIOR, INTERIOR/EXTERIOR.
- Times of day, with or without accents, a full stop after them allowed: DÍA, NOCHE, AMANECER, ALBA, SALIDA DEL SOL
  (dawn); ATARDECER, ANOCHECER, CREPÚSCULO, OCASO, PUESTA DE SOL (dusk); HORA MÁGICA.
- Anything else after the place (CONTINUO, MÁS TARDE, MAÑANA) is kept as written, as CONTINUOUS is in English.
- Full stops between the parts, as many Spanish scripts write them: `INT. CASA. NOCHE` reads as `INT. CASA - NOCHE`.
  Only when a time of day follows, so a place with a dot in it (`EXT. ST. JAMES`) stays whole.

## Checked

- Every key English has, with the same placeholders (unit test). Sentences built round a counted phrase read right at 1
  and at 3 ("1 cuadro", "3 cuadros"), worded so nothing else has to agree with the count (unit test).
- The native Open dialogs (pictures, scripts) take their title and filter name from the translation.
- At 1280 by 720 (`e2e/spanish.spec.ts`): no button, tab, radio, label, column or row header, menu item, truncated
  label or tile title bar overflows, or reaches past what clips it, in the six workspaces, the shot list, the Layout and
  Project menus, every Settings tab, Export, Watermark Settings, the frame and scene inspectors (with department
  states ticked), and the History, Trash and Color script tiles. Scene names are the person's text and aren't checked.
  Not yet covered: the sketch and crop editors, the slash menu, Import script, confirm windows and notices.
- Picking Español in Settings → App switches the open app at once, and English switches it back (e2e).
- Every word of the PDF storyboard stays inside the page in Spanish, in a wide and a tall project (unit test).
