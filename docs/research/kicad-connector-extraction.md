# Extracting connectors, Pins and net names from a .kicad_pcb

Resolves [#2](https://github.com/Akzelch/wiring-application/issues/2). Tested on 2026-11-09 with `kicad-cli` 10.0.8 against `DroneController.kicad_pcb` (sample data, unmodified; SHA-256 identical before and after).

## Recommendation

**Parse the `.kicad_pcb` S-expression directly in Node.** A tokenizer of about 25 lines parsed the 928 KB sample in 51 ms. It needs no KiCad install and is the only route that gives reference, Pin number, net name, footprint library, value and `pinfunction` in one place.

Read the net name as the **last** element of the pad's `net` list, so both the KiCad 9 and KiCad 10 shapes work.

## Why not `kicad-cli`

`pcb export` has no netlist export in KiCad's own format and no JSON pad or net output. The subcommands are `3dpdf, brep, drill, dxf, gencad, gerbers, glb, hpgl, ipc2581, ipcd356, odb, pdf, ply, pos, ps, stats, step, stl, stpz, svg, u3d, vrml, xao` ([CLI docs](https://docs.kicad.org/10.0/en/cli/cli.html), `kicad-cli pcb export --help`). `sch export netlist` exists, but needs the schematic, and the import starts from a PCB.

| Route | Result on the sample | Verdict |
|---|---|---|
| `pcb export ipcd356` | Fixed-width columns. Pad numbers are cut (`A4-B9` becomes `A4-B`), reference column is 6 wide, long nets are replaced by aliases (`M0005`) resolved through header lines, net names are upper-cased in places (`NET-(AE1-A)`). | Lossy; reject |
| `pcb export gencad` | Clean `SIGNAL "net"` / `NODE "ref" "pin"` lines with full names. Still needs its own parser and deduplication. | Workable, no better than the board file |
| `pcb export ipc2581` | 3.3 MB of XML. `PinRef` lists synthetic pins such as `NPTH0`. Net structure not examined further. | Too heavy |
| `pcb export pos` | Footprint placement options only; no Pin or net options in `--help`. | Not applicable |

Each CLI route also adds a runtime dependency, about 0.5 to 1 s per run, and debug noise on stderr. It would still need a text parser afterwards.

## S-expression shape

The sample is **not** KiCad 10 format: `(version 20241229)`, `(generator_version "9.0")`. To see the KiCad 10 shape, a temp copy was upgraded with `kicad-cli pcb upgrade --force`, giving `(version 20260206)`.

KiCad 9 (the sample):

```
(footprint "easyeda2kicad:CONN-TH_B2B-XH-A-LF-SN"
  (layer "F.Cu")
  (uuid "08e1ccb5-...")
  (at 112 54.4 90)
  (property "Reference" "BATT1" (at -1.2 -4.5 90) ...)
  (property "Value" "Connector" ...)
  (attr through_hole)
  (pad "1" thru_hole circle
    (at 1.27 0 270)
    ...
    (net 2 "+BATT")
    (pinfunction "Pin_1")
    (pintype "passive")
    (uuid "bcf1d81f-...")))
```

KiCad 10 changes one thing relevant here: the pad's `(net 2 "+BATT")` becomes `(net "+BATT")`, and the top-level `(net 0 "") (net 1 "+3.3V") ...` table disappears (76 entries down to 0). Segments change from `(net 1)` to `(net "+3.3V")`.

The source records this as format `20251028`: "Stop writing netcodes; they're an internal implementation detail" ([`pcb_io_kicad_sexpr.h`, branch 10.0](https://gitlab.com/kicad/code/kicad/-/raw/10.0/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.h)). The [published format docs](https://dev-docs.kicad.org/en/file-formats/sexpr-intro/index.html) still show `(net NUMBER "NAME")`, so they lag KiCad 10.

After the upgrade, all 276 pad rows (footprint, reference, pad number, net name) were identical to the original.

The docs say only that strings are double-quoted UTF-8, and document no escape rules. The tokenizer here treats backslash as an escape character.

## Fields available

- **Footprint**: library link (first string), `layer`, `at`, `uuid`, `path`, `sheetname`, `sheetfile`, `attr`, `descr`, `tags`, optional `locked`, and `property` entries: `Reference`, `Value`, `Datasheet`, `Description`, plus any custom fields.
- **Pad**: number (quoted string), type (`thru_hole`, `smd`, `np_thru_hole`, ...), shape, `at`, `size`, `layers`, optional `net`, `pinfunction` (schematic Pin name), `pintype`, `uuid`.

In this file the reference is always `property "Reference"`. All `fp_text` entries are `user` text. Formats older than this one were not tested.

## Sample counts

74 footprints, 276 pads, 75 distinct net names on pads.

**Connectors: 7, and none has a `J` reference.** This count is a judgement from library name and value:

| Reference | Library | Pads | Distinct numbered Pins |
|---|---|---|---|
| `BATT1` | `easyeda2kicad:CONN-TH_B2B-XH-A-LF-SN` | 2 | 2 |
| `UART2` | `easyeda2kicad:CONN-TH_B2B-XH-A-LF-SN` | 2 | 2 |
| `+3.3V` | `easyeda2kicad:CONN-TH_B2B-XH-A-LF-SN` | 2 | 2 |
| `UART1` | `Connector_PinHeader_2.00mm:PinHeader_1x04_P2.00mm_Vertical` | 4 | 4 |
| `SWD1` | `Connector_PinHeader_2.00mm:PinHeader_1x04_P2.00mm_Vertical` | 4 | 4 |
| `P1` (USB-C) | `USB-C:USB-C` | 20 | 16 |
| `AE1` (SMA) | `Connector_Coaxial:SMA_BAT_Wireless_BWSMA-KWE-Z001` | 5 | 2 |

Not counted: test points (`SCK1`, `MOSI1`, `MISO1` and others), switches (`RESET1`, `SW2`) and mounting holes.

## Edge cases

| Case | In the sample | Handling |
|---|---|---|
| Pad with no net | 25 pads have no `net` token at all (for example `AE1` pad `2` four times). No pad uses `(net 0 "")`. | Treat a missing `net` as "no net". |
| Unconnected Pin | 25 auto-named nets such as `unconnected-(P1-SBU1-PadA8)`. On no-connect Pins `pintype` ends `+no_connect`. | Treat the `unconnected-` prefix as "no net", or show it dimmed. |
| Unnamed net | 21 auto-named nets such as `Net-(AE1-A)`, `Net-(P1-CC1)`. | Keep as text. The name derives from a reference and Pin, so it can change between imports. |
| Hierarchical or global names | 25 names start with `/` (`/SWCLK`); others are like `+3.3V`, `GND`. | Keep as written. |
| Escapes in names | `Net-(U6-~{RESET})`, `{slash}` inside names. | Decode `{slash}` for display; `~{...}` is overbar markup. Decode only for display, and compare raw values. |
| Empty pad number | 21 pads: `P1` (2, `np_thru_hole`), `U5` (16, `smd`, no net), mounting holes and other `REF**` (3). | Skip pads with `""` as number. |
| Duplicate pad number | `P1` `A4-B9` and `B4-A9` twice each, `AE1` `2` four times, `U9` `2` twice. All duplicates share a net in this sample. | Merge into one Pin. If duplicates ever carry different nets, warn in the import. |
| Non-numeric pad number | `A1-B12`, `S1`. | Pin numbers are strings. Sort naturally. |
| Duplicate reference | `REF**` 7 times, `G***` 2 times (test points, holes, logos). | Leave out of the checklist, or at least never match on them. |
| Unusual reference | `+3.3V` is a connector's reference. | Treat references as opaque strings. |
| Logos | `G***`: 0 pads. | Drop footprints with no Pins. |

## Import recipe

1. Parse, then take each top-level `footprint`.
2. Reference = `property "Reference"`; skip placeholders `REF**`, `G***` and footprints with no numbered pads.
3. Pins = pads with non-empty number, merged by number. Net = last element of `net`, or none. Pin name = `pinfunction`, if present.
4. Show every remaining footprint in the checklist with reference, value and library.
