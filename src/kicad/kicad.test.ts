import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { apply, copyItems, emptyProject, emptySelection, makePins, type Command } from '../project/project.ts';
import type { Project } from '../project/types.ts';
import { pinPoint, wireWarnings } from '../routing/routing.ts';
import { checklist, mergeImport, readConnectors, type Connector } from './kicad.ts';

const SAMPLE = '/home/axels/Documents/Thread/reference_project/KiCad/DroneController.kicad_pcb';

const footprint = (reference: string, pads: string) =>
  `(footprint "Lib:Part" (layer "F.Cu") (property "Reference" "${reference}" (at 0 0)) ${pads})`;
const board = (...footprints: string[]) => `(kicad_pcb (version 20241229) (net 0 "") ${footprints.join(' ')})`;
const pad = (number: string, net: string) => `(pad "${number}" thru_hole circle (at 0 0) ${net})`;

const run = (project: Project, ...commands: Command[]): Project => commands.reduce(apply, project);
const connector = (reference: string, ...pins: [string, string][]): Connector => ({
  reference,
  pins: pins.map(([number, net]) => ({ number, net })),
});
const UART1 = connector('UART1', ['1', 'GND'], ['2', 'Debug_RX'], ['3', 'Debug_TX'], ['4', '+3.3V']);
const imported = (...connectors: Connector[]) =>
  mergeImport(emptyProject(), connectors, connectors.map(c => c.reference)).project;

test('reads the Net as the last element of the pad net list, for KiCad 9 and 10', () => {
  const text = board(footprint('J1', `${pad('1', '(net 1 "GND")')} ${pad('2', '(net "+5V")')} ${pad('3', '')}`));
  assert.deepEqual(readConnectors(text), [connector('J1', ['1', 'GND'], ['2', '+5V'], ['3', ''])]);
});

test('falls back to fp_text for the reference', () => {
  const text = board(`(footprint "Lib:Part" (fp_text reference "J7" (at 0 0)) ${pad('1', '')})`);
  assert.equal(readConnectors(text)[0].reference, 'J7');
});

test('cleans Net names', () => {
  const pads = [
    pad('1', '(net 1 "unconnected-(J1-Pad1)")'),
    pad('2', '(net 2 "/Power/VBUS")'),
    pad('3', '(net 3 "/A{slash}B")'),
    pad('4', '(net 4 "{slash}C")'),
  ];
  assert.deepEqual(readConnectors(board(footprint('J1', pads.join(' '))))[0].pins.map(p => p.net), [
    '',
    'Power/VBUS',
    'A/B',
    '/C',
  ]);
});

test('reads quoted strings with escaped quotes', () => {
  const text = board(footprint('J1', pad('1', String.raw`(net 1 "A\"B")`)));
  assert.equal(readConnectors(text)[0].pins[0].net, 'A"B');
});

test('skips non-plated and unnumbered pads, and merges duplicate numbers keeping a Net', () => {
  const pads = [
    '(pad "MP" np_thru_hole circle (at 0 0))',
    '(pad "" smd rect (at 0 0) (net 1 "GND"))',
    pad('1', ''),
    pad('1', '(net 2 "VCC")'),
    pad('2', '(net 3 "A")'),
  ];
  assert.deepEqual(readConnectors(board(footprint('J1', pads.join(' '))))[0].pins, [
    { number: '1', net: 'VCC' },
    { number: '2', net: 'A' },
  ]);
});

test('Pins and connectors are in natural order', () => {
  const text = board(footprint('J10', `${pad('10', '')} ${pad('2', '')}`), footprint('J2', pad('1', '')));
  const connectors = readConnectors(text);
  assert.deepEqual(connectors.map(c => c.reference), ['J2', 'J10']);
  assert.deepEqual(connectors[1].pins.map(p => p.number), ['2', '10']);
});

test('leaves out duplicate references and footprints with no pads', () => {
  const text = board(
    footprint('REF**', pad('1', '')),
    footprint('REF**', pad('1', '')),
    footprint('H1', '(pad "" np_thru_hole circle (at 0 0))'),
    footprint('J1', pad('1', '')),
  );
  assert.deepEqual(readConnectors(text).map(c => c.reference), ['J1']);
});

test('the sample board gives its connectors and no excluded footprints', { skip: !existsSync(SAMPLE) }, () => {
  const connectors = readConnectors(readFileSync(SAMPLE, 'utf8'));
  const references = connectors.map(c => c.reference);
  assert.ok(connectors.length > 20);
  assert.equal(new Set(references).size, references.length);
  assert.ok(!references.includes('REF**') && !references.includes('G***'));
  assert.ok(connectors.every(c => c.pins.length > 0));
  assert.ok(connectors.flatMap(c => c.pins).every(p => !p.net.startsWith('unconnected-') && !p.net.startsWith('/')));
  assert.deepEqual(connectors.find(c => c.reference === 'UART1'), UART1);
  assert.ok(checklist(emptyProject(), connectors).every(e => !e.ticked));
});

test('the checklist pre-ticks J* and anything already imported', () => {
  const connectors = [connector('J1', ['1', '']), connector('U1', ['1', '']), connector('U2', ['1', ''])];
  const project = mergeImport(emptyProject(), connectors, ['U2']).project;
  assert.deepEqual(
    checklist(project, connectors).map(e => [e.reference, e.ticked, e.clash]),
    [['J1', true, false], ['U1', false, false], ['U2', true, false]],
  );
});

const customJ1 = () =>
  apply(emptyProject(), {
    type: 'createBlock',
    name: 'J1',
    label: '',
    at: { x: 0, y: 0 },
    pins: makePins({ left: 1, right: 0, top: 0, bottom: 0 }),
  });

test('a name clash with a custom Block is shown, not ticked, and skipped by the import', () => {
  const connectors = [connector('J1', ['1', 'GND'])];
  const start = customJ1();
  assert.deepEqual(checklist(start, connectors), [{ reference: 'J1', pinCount: 1, ticked: false, clash: true }]);
  const { project } = mergeImport(start, connectors, ['J1']);
  assert.equal(project.blocks.length, 1);
  assert.equal(project.blocks[0].kicadLinked, false);
  assert.equal(project.blocks[0].pins[0].net, '');
});

test('a new Block arrives KiCad-linked with all Pins on one side and clear of other Blocks', () => {
  const project = imported(connector('J1', ['1', 'GND'], ['2', '']), connector('J2', ['1', '']));
  const [a, b] = project.blocks;
  assert.equal(a.kicadLinked, true);
  assert.deepEqual(a.pins.map(p => [p.number, p.net, p.order]), [['1', 'GND', 0], ['2', '', 1]]);
  assert.equal(new Set(a.pins.map(p => p.side)).size, 1);
  assert.ok(b.y >= a.y + 60);
});

test('only ticked connectors are imported', () => {
  const connectors = [connector('J1', ['1', '']), connector('U1', ['1', ''])];
  assert.deepEqual(mergeImport(emptyProject(), connectors, ['U1']).project.blocks.map(b => b.name), ['U1']);
});

const wiredPair = () => {
  const start = imported(connector('J1', ['1', 'A'], ['2', 'B'], ['3', 'C']), connector('J2', ['1', 'A']));
  const [j1, j2] = start.blocks;
  return run(
    {
      ...start,
      blocks: [
        { ...j1, x: 500, y: 40, pins: j1.pins.map(p => (p.number === '2' ? { ...p, userName: 'Mine', side: 'right' as const, order: 0 } : p)) },
        { ...j2, x: 900, y: 40 },
      ],
    },
    { type: 'addWire', from: { blockId: j1.id, pinId: j1.pins[1].id }, to: { blockId: j2.id, pinId: j2.pins[0].id }, corners: [], colours: ['red'] },
  );
};

test('re-import refreshes Nets and keeps user names, positions and Pin sides', () => {
  const start = wiredPair();
  const { project, report } = mergeImport(
    start,
    [connector('J1', ['1', 'A'], ['2', 'NEW'], ['3', 'C']), connector('J2', ['1', 'A'])],
    ['J1', 'J2'],
  );
  const j1 = project.blocks[0];
  assert.deepEqual([j1.x, j1.y], [500, 40]);
  assert.deepEqual(j1.pins[1], { ...start.blocks[0].pins[1], net: 'NEW' });
  assert.equal(project.blocks.length, 2);
  assert.deepEqual(report, { orphanedWires: [], missingBlocks: [] });
});

test('re-import leaves unticked Blocks alone', () => {
  const start = wiredPair();
  const { project } = mergeImport(start, [connector('J1', ['2', 'NEW']), connector('J2', ['1', 'A'])], ['J2']);
  assert.deepEqual(project.blocks[0], start.blocks[0]);
});

test('a board Pin that is new joins an existing Block without moving wired Pins', () => {
  const start = wiredPair();
  const { project } = mergeImport(start, [connector('J1', ['1', ''], ['2', ''], ['3', ''], ['4', 'D'])], ['J1']);
  const j1 = project.blocks[0];
  const added = j1.pins.find(p => p.number === '4')!;
  assert.ok(!start.blocks[0].pins.some(p => p.id === added.id));
  assert.deepEqual(pinPoint(j1, j1.pins[1]), pinPoint(start.blocks[0], start.blocks[0].pins[1]));
  assert.equal(new Set(j1.pins.filter(p => p.side === added.side).map(p => p.order)).size, j1.pins.filter(p => p.side === added.side).length);
});

test('a vanished Pin with a Wire stays as a warned leftover and is reported', () => {
  const start = wiredPair();
  const { project, report } = mergeImport(start, [connector('J1', ['1', 'A'], ['3', 'C']), connector('J2', ['1', 'A'])], ['J1', 'J2']);
  const leftover = project.blocks[0].pins.find(p => p.number === '2')!;
  assert.equal(leftover.leftover, true);
  assert.deepEqual([...wireWarnings(project)], ['w1']);
  assert.deepEqual(report.orphanedWires, [{ wireId: 'w1', block: 'J1', pin: '2' }]);
});

test('a vanished Pin with no Wire is removed and the remaining Pins close up', () => {
  const { project } = mergeImport(wiredPair(), [connector('J1', ['2', 'B'], ['3', 'C']), connector('J2', ['1', 'A'])], ['J1', 'J2']);
  const pins = project.blocks[0].pins;
  assert.deepEqual(pins.map(p => p.number), ['2', '3']);
  assert.deepEqual(pins.map(p => p.order), [0, 0]);
});

test('a leftover Pin that returns to the board is no longer a warning', () => {
  const gone = mergeImport(wiredPair(), [connector('J1', ['1', 'A'])], ['J1']).project;
  const { project, report } = mergeImport(gone, [connector('J1', ['1', 'A'], ['2', 'B']), connector('J2', ['1', 'A'])], ['J1']);
  assert.equal('leftover' in project.blocks[0].pins.find(p => p.number === '2')!, false);
  assert.deepEqual([...wireWarnings(project)], []);
  assert.deepEqual(report.orphanedWires, []);
});

test('a pasted Block does not inherit leftover Pins, since it can never be re-imported', () => {
  const gone = mergeImport(wiredPair(), [connector('J1', ['1', 'A'])], ['J1']).project;
  const clipboard = copyItems(gone, { ...emptySelection(), blocks: ['b1'] });
  const pasted = apply(gone, { type: 'paste', clipboard, offset: { x: 0, y: 400 } });
  assert.ok(pasted.blocks[2].pins.every(p => !('leftover' in p)));
});

test('a KiCad-linked Block gone from the board is kept and reported; custom Blocks are not', () => {
  const start = wiredPair();
  const withCustom = apply(start, { type: 'createBlock', name: 'Relay', label: '', at: { x: 0, y: 600 }, pins: [] });
  const { project, report } = mergeImport(withCustom, [connector('J1', ['1', 'A'], ['2', 'B'], ['3', 'C'])], ['J1']);
  assert.deepEqual(project.blocks.map(b => b.name), ['J1', 'J2', 'Relay']);
  assert.deepEqual(report.missingBlocks, ['J2']);
});
