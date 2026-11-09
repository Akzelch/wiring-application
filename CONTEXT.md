# Wiring Application

A personal engineering utility for laying out and iterating on the wiring of one small electrical project, and exporting what connects to what.

## Language

**Block**:
A connector or custom component placed on the layout, with named pins on its sides.
_Avoid_: Component, part, node

**Label**:
Optional free text on a Block saying what it is, such as "Front ECU". It is separate from the Block's name, which stays fixed for Blocks imported from KiCad.
_Avoid_: Title, description

**Note**:
Free text placed on the layout and connected to nothing. Unlike a Label, it does not belong to a Block.
_Avoid_: Text box, comment, annotation

**Pin**:
A single connection point on a side of a Block. It has a fixed number, and optionally a Net and a name given by the user.
_Avoid_: Terminal, port, pad

**Net**:
The electrical signal name KiCad gives a Pin, such as "GND". Several Pins on different Blocks can share one. A Net is information about a Pin, not something placed on the layout.
_Avoid_: Signal

**Wire**:
One conductor between two Pins, with one or two colours (a base colour and an optional second colour, such as green/yellow). An unfinished Wire has its start Pin but no end Pin yet.
_Avoid_: Cable, connection, line

**Harness**:
A named group of individual Wires that will be physically bundled together.
_Avoid_: Bundle, cable, loom

**Zone**:
A named rectangular region of the layout that groups Blocks by physical area, such as "Front lights" or "ECU".
_Avoid_: Area, segment, section, group

**Wire size**:
The standard conductor cross-section of a Wire, shown in mm² with the equivalent AWG. A Wire may have none set.
_Avoid_: Diameter, thickness

**Zone distance**:
The approximate length in millimetres given to a pair of Zones. It is printed as the length of every Wire running between them, with nothing added.
_Avoid_: Route length, Wire length

**Scale**:
The factor, in half steps, that enlarges a Block and its Pin spacing so Pins stay on the grid.
_Avoid_: Zoom, size
