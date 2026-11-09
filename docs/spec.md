# Wiring Application: build spec

A local, file-based app for laying out the wiring of one small electrical project and exporting what connects to what. Readability beats appearance; do not add features beyond this page. Vocabulary is in `CONTEXT.md`. Decisions and their reasons are on the map, [Wayfinder: wiring layout app spec](https://github.com/Akzelch/wiring-application/issues/1).

## Running

TypeScript, Preact and esbuild in the browser, with a small Node server bound to localhost. `start.sh` (Linux) and `start.bat` (Windows) run `npm install` if `node_modules` is missing, build, start the server on the project file given as an argument (default `project.json` in the repo root) and open the default browser. They stop with a clear message if Node is missing. All other logic stays in Node. `npm start -- path/to/project.json` does the same without opening a browser. A missing project file is created empty on first save. Target browser: Firefox.

## Project file

One pretty-printed JSON file with stable IDs and every list sorted by ID: `version`, `blocks`, `wires`, `harnesses`, `zones`, `notes`, `customColours`.

- Block: `id`, `name`, `label`, `kicadLinked`, `x`, `y`, `pins`.
- Pin: `id`, `number`, `net`, `userName`, `side`, `order`, and `leftover: true` on a Pin kept only because a Wire uses it after it disappeared from the board.
- Wire: `id`, `from` and `to` as `{blockId, pinId}`, `corners`, `colours` (one or two).
- Harness: `id`, `name`, `wireIds`, arc position.
- Zone: `id`, `name`, rectangle.
- Note: `id`, `text`, `x`, `y`.

Never stored: Zone membership, side-by-side lanes, undo history, zoom and pan. Rotation is stored only as each Pin's `side`.

Autosave runs about 1 second after an edit and sends the file's last-seen modification time. On a mismatch, autosave stops and the page shows "file changed on disk, reload".

## Modules

| Module | Interface | Tested |
| --- | --- | --- |
| Project | pure `apply(project, command) → project`; undo by snapshots | through the interface |
| Routing | pure Wire geometry: stretch, kink, legal slide, lanes | through the interface |
| KiCad import | `readConnectors(text)`, `mergeImport(project, connectors, ticked)` | through the interface, with the sample board |
| Export | from/to rows and print view | rows through the interface |
| File store | Node server: load and save | through the interface |
| Canvas | SVG rendering, selection, hotkeys | by hand in Firefox |

Rewrite rather than reuse the [canvas prototype](https://github.com/Akzelch/wiring-application/blob/prototype/canvas-interaction/prototypes/canvas-interaction.prototype.html), but port its routing logic into Routing with tests. It is the behaviour reference for everything under Wires.

## Layout objects

- **Blocks**: at most about 15. Created from a form with a name and Pin count per side; Pins are numbered by default, renamable and movable between sides in that form. Editing a custom Block can add Pins, or remove unwired ones from the end of a side; a KiCad-linked Block gets its Pins from the board. Names are unique: the form refuses a duplicate. Optional Label. A Pin displays its user name, else its Net, else its number. `R` turns a Block 90° clockwise about its centre; Pins move with their sides, text stays upright, and Wires follow the drag rules below.
- **Zones**: labelled, resizable rectangles behind the Blocks. A Block or Note is in a Zone when its centre is inside. Dragging a Zone moves only the Zone; holding `Shift` while dragging carries them. A new Zone surrounds the selected Blocks and Notes with a margin; with none selected it is a default rectangle in the middle of the view.
- **Notes**: `N` then a click places one; double-click edits. Multi-line, box grows to fit, no formatting. Drag, multi-select, copy/paste, delete and undo work as for Blocks; no rotation. Drawn above Wires and Zones, with no effect on routing.
- **Harnesses**: a named set of Wires, drawn as one draggable arc across them with its name beside it. A Wire is in at most one Harness. The arc is only a marker.

## Wires

- Drawing is KiCad-style: click a Pin (or `W`), click empty space to add a right-angle bend and corner, `Space` flips the bend, `Backspace` removes the last corner, and the Wire arrives straight into the end Pin. A Pin may take several Wires: click it again to start another. A Pin with more than one Wire is drawn dark. There is no splice object and no auto-routing.
- Double-clicking while drawing ends the Wire unfinished at its last corner, with no end Pin. A marker shows the loose end; clicking it continues drawing, and `Backspace` can then remove earlier corners. Moving the start Block leaves the loose end where it is. Copying its start Block copies it. The PDF lists unfinished Wires under Warnings and shows "unfinished" in To.
- Dragging or rotating a Block changes only the segments at that Block's end. A straight Wire gains a jog at its midpoint when needed, which disappears if the Block moves back. Moving a Block past its own Wires is allowed.
- A segment can be dragged to slide it.
- A Wire never runs along a Block's side out of a Pin; it kinks out 20 units (one Pin spacing) first.
- A Wire never passes over a Pin that is not its own end: sliding stops at the last legal position, and a drawing click that would cross a Pin is refused. If moving a Block puts a Pin onto another Wire, the move is allowed and that Wire is drawn in the loud warning style.
- Overlapping Wires are drawn side by side, exactly touching, until they split, each on the side it turns towards. A Harness's Wires are drawn together, with a gap to Wires outside it, so its marker does not reach them. This affects drawing only.
- Colours: black, brown, red, orange, yellow, green, blue, violet, grey, white, pink, plus user-defined colours. Two colours draw as alternating dashes. New Wires reuse the last colour. A picker panel handles the second colour and custom colours.
- Readability: hovering a Block highlights its Wires and dims the others; zoom and pan.

## Hotkeys

`W` start Wire, `N` Note, `R` rotate, `H` Harness from selected Wires, `Esc` cancel, `Del` delete, `Ctrl+C`/`Ctrl+V` copy/paste, `Ctrl+D` duplicate, `Ctrl+Z`/`Ctrl+Y` undo/redo, `Ctrl+A` select all, `Ctrl+S` save, `1`-`9` set the selected Wire's colour.

Copy/paste: Wires with both ends in the selection are copied; Wires with one end are dropped. Pasted Wires are in no Harness. A pasted Block takes the next free number (`J1` to `J2`, `Relay` to `Relay2`, `+3.3V` to `+3.3V2`), keeps its Label and has no KiCad link.

## KiCad import

Parse the `.kicad_pcb` S-expression directly in Node with a small tokeniser; do not use `kicad-cli`. Findings: [KiCad extraction research](https://github.com/Akzelch/wiring-application/blob/research/kicad-connector-extraction/docs/research/kicad-connector-extraction.md).

- Read the reference from `(property "Reference" ...)`, falling back to `(fp_text reference ...)`. Read the Net as the last element of the pad's `net` list, which covers KiCad 9 and 10. A missing Net is no Net.
- Skip `np_thru_hole` pads and empty pad numbers; merge duplicate numbers into one Pin. Treat `unconnected-` Nets as empty, strip a leading `/`, decode `{slash}`.
- Checklist of footprints, leaving out duplicate references (`REF**`, `G***`) and footprints with no pads. Pre-tick `J*` and anything already imported. Show a name clash with a custom Block in the checklist.
- A new Block arrives with all Pins on one side.
- Re-import matches Blocks by reference among `kicadLinked` Blocks only, and Pins by number. It refreshes Nets, and keeps user names, positions and Pin sides.
- A Wire whose Pin disappeared is kept, drawn in the warning style on a leftover Pin, and listed in the report after the import. An imported Block no longer on the board is kept and listed in the same report.

Sample for tests only: `/home/axels/Documents/Thread/reference_project/KiCad/DroneController.kicad_pcb`. It has no `J*` references.

## PDF export

A print-only view with `@page { size: A3 landscape }`, saved through Firefox's "Save to PDF". First confirm that Firefox honours A3 and keeps the dashes intact; only if it does not, generate the PDF in Node with `pdfkit` and `svg-to-pdfkit`.

The whole layout, including Notes, is scaled to one page. Then a "Warnings" list, then a from/to table sorted by Block with columns From, To, Colour, Harness, and Zone for each end. From and To read `J1 (Front ECU) : 3 GND`. Colours are spelled out by name. Warning Wires print thick with a `!` marker. Touching Wires print as on screen.

## Build sessions

1. Project, Routing, File store, Canvas, launchers: a working editor.
2. KiCad import and Export.

## Out of scope

Auto-routing, Wire lengths and real-world scale, background images, connector part numbers and bills of materials, multi-user features.
