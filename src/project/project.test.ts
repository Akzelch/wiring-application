import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPaths, harnessArc, resumeDraw, wirePath, wireWarnings, WIRE_WIDTH } from '../routing/routing.ts';
import {
  apply,
  commit,
  copyItems,
  emptyProject,
  emptySelection,
  makePins,
  parseProject,
  pinFloor,
  pinLabel,
  redo,
  resizedPins,
  serialize,
  startHistory,
  undo,
  type Command,
} from './project.ts';
import type { Pin, Project } from './types.ts';

const run = (project: Project, ...commands: Command[]): Project => commands.reduce(apply, project);

const counts = (left: number, right: number, top = 0, bottom = 0) => ({ left, right, top, bottom });

const twoBlocks = () =>
  run(
    emptyProject(),
    { type: 'createBlock', name: 'J1', label: '', at: { x: 300, y: 300 }, pins: makePins(counts(0, 4)) },
    { type: 'createBlock', name: 'J2', label: '', at: { x: 900, y: 300 }, pins: makePins(counts(4, 0)) },
  );

const straight = (project: Project, fromPin = 'p1', toPin = 'p1') =>
  apply(project, {
    type: 'addWire',
    from: { blockId: 'b1', pinId: fromPin },
    to: { blockId: 'b2', pinId: toPin },
    corners: [],
    colours: ['red'],
  });

const move = (project: Project, blockId: string, x: number, y: number) =>
  apply(project, { type: 'moveItems', selection: { ...emptySelection(), blocks: [blockId] }, delta: { x, y } });

test('dragging a Block stretches only the segments at its end', () => {
  const start = apply(twoBlocks(), {
    type: 'addWire',
    from: { blockId: 'b1', pinId: 'p2' },
    to: { blockId: 'b2', pinId: 'p3' },
    corners: [{ x: 600, y: 340 }, { x: 600, y: 360 }],
    colours: ['red'],
  });
  const moved = move(start, 'b2', 100, 60);
  const wire = moved.wires[0];
  assert.deepEqual(wirePath(moved, wire)[0], { x: 400, y: 340 });
  assert.deepEqual(wire.corners[0], { x: 600, y: 340 });
  assert.equal(wire.corners[1].x, 600);
  assert.equal(wire.corners[1].y, 420);
});

test('a straight Wire gains a jog and loses it when the Block returns', () => {
  const start = straight(twoBlocks());
  const jogged = move(start, 'b2', 0, -80);
  assert.equal(jogged.wires[0].corners.length, 2);
  assert.deepEqual(move(jogged, 'b2', 0, 80).wires[0].corners, []);
});

test('moving both ends together keeps the Wire shape', () => {
  const start = apply(twoBlocks(), {
    type: 'addWire',
    from: { blockId: 'b1', pinId: 'p2' },
    to: { blockId: 'b2', pinId: 'p3' },
    corners: [{ x: 600, y: 340 }, { x: 600, y: 360 }],
    colours: ['red'],
  });
  const moved = apply(start, {
    type: 'moveItems',
    selection: { ...emptySelection(), blocks: ['b1', 'b2'] },
    delta: { x: 10, y: 20 },
  });
  assert.deepEqual(moved.wires[0].corners, [{ x: 610, y: 360 }, { x: 610, y: 380 }]);
});

test('a Wire never runs along a Block side: it kinks out one Pin spacing', () => {
  const start = straight(twoBlocks());
  const slid = apply(start, { type: 'slideSegment', wireId: 'w1', index: 0, delta: { x: 0, y: -50 } });
  const [pin, first] = wirePath(slid, slid.wires[0]);
  assert.deepEqual(pin, { x: 400, y: 320 });
  assert.equal(first.y, 320);
  assert.ok(first.x > 400);
});

test('sliding across a Pin is refused and leaves the project unchanged', () => {
  const start = apply(twoBlocks(), {
    type: 'addWire',
    from: { blockId: 'b1', pinId: 'p1' },
    to: { blockId: 'b2', pinId: 'p1' },
    corners: [{ x: 600, y: 320 }, { x: 600, y: 200 }, { x: 800, y: 200 }, { x: 800, y: 320 }],
    colours: ['red'],
  });
  const refused = apply(start, { type: 'slideSegment', wireId: 'w1', index: 1, delta: { x: 300, y: 0 } });
  assert.equal(refused, start);
});

test('moving a Block so a Pin lands on another Wire is allowed and warned', () => {
  const start = run(straight(twoBlocks()), {
    type: 'createBlock',
    name: 'J3',
    label: '',
    at: { x: 600, y: 100 },
    pins: makePins(counts(1, 0)),
  });
  const moved = move(start, 'b3', 0, 200);
  assert.deepEqual(wirePath(moved, moved.wires[0]).length, 2);
  assert.deepEqual([...wireWarnings(moved)], ['w1']);
  assert.deepEqual([...wireWarnings(start)], []);
});

test('rotation moves Pins clockwise, keeps the centre and reroutes only that end', () => {
  const start = straight(twoBlocks());
  const rotated = apply(start, { type: 'rotateBlocks', blockIds: ['b1'] });
  const block = rotated.blocks[0];
  assert.ok(block.pins.every(p => p.side === 'bottom'));
  assert.deepEqual(block.pins.map(p => p.order), [3, 2, 1, 0]);
  const fourTimes = run(start, ...Array(4).fill({ type: 'rotateBlocks', blockIds: ['b1'] }));
  assert.deepEqual(fourTimes.blocks[0], start.blocks[0]);
  const path = wirePath(rotated, rotated.wires[0]);
  assert.equal(path[path.length - 1].x, 900);
  assert.equal(path[0].x, path[1].x);
});

test('overlapping Wires are drawn exactly touching without changing stored routes', () => {
  const start = apply(straight(twoBlocks()), {
    type: 'addWire',
    from: { blockId: 'b1', pinId: 'p1' },
    to: { blockId: 'b2', pinId: 'p1' },
    corners: [],
    colours: ['blue'],
  });
  const paths = displayPaths(start);
  assert.ok(Math.abs(paths.get('w1')![0].y - paths.get('w2')![0].y) - WIRE_WIDTH < 1e-9);
  assert.deepEqual(start.wires[0].corners, []);
});

test('paste numbers names, drops one-ended Wires and clears KiCad link and Harness', () => {
  const start = run(
    straight(twoBlocks()),
    { type: 'createHarness', name: 'Main', wireIds: ['w1'] },
    { type: 'createBlock', name: 'Relay', label: 'Pump', at: { x: 0, y: 0 }, pins: makePins(counts(1, 1)) },
    { type: 'createBlock', name: '+3.3V', label: '', at: { x: 0, y: 200 }, pins: makePins(counts(1, 1)) },
  );
  const pair = copyItems(start, { ...emptySelection(), blocks: ['b1', 'b2', 'b3', 'b4'] });
  const pasted = apply(start, { type: 'paste', clipboard: pair, offset: { x: 40, y: 40 } });
  assert.deepEqual(pasted.blocks.slice(4).map(b => b.name), ['J3', 'J4', 'Relay2', '+3.3V2']);
  assert.equal(pasted.blocks[6].label, 'Pump');
  assert.equal(pasted.wires.length, 2);
  assert.deepEqual(pasted.wires[1].from, { blockId: 'b5', pinId: 'p1' });
  assert.deepEqual(pasted.harnesses[0].wireIds, ['w1']);

  const oneEnd = copyItems(start, { ...emptySelection(), blocks: ['b1'] });
  assert.deepEqual(oneEnd.wires, []);
});

test('Block names are unique', () => {
  const start = twoBlocks();
  assert.equal(apply(start, { type: 'createBlock', name: 'J1', label: '', at: { x: 0, y: 0 }, pins: [] }), start);
});

test('a Pin displays its user name, else its Net, else its number', () => {
  const pin = makePins(counts(1, 0))[0];
  assert.equal(pinLabel(pin), '1');
  assert.equal(pinLabel({ ...pin, net: 'GND' }), 'GND');
  assert.equal(pinLabel({ ...pin, net: 'GND', userName: 'Ground' }), 'Ground');
});

test('a Wire joins at most one Harness', () => {
  const start = run(
    straight(twoBlocks()),
    { type: 'createHarness', name: 'A', wireIds: ['w1'] },
    { type: 'createHarness', name: 'B', wireIds: ['w1'] },
  );
  assert.deepEqual(start.harnesses.map(h => h.name), ['B']);
});

test('a Harness marker and name follow its Wires when they move', () => {
  const oneWire = run(straight(twoBlocks()), { type: 'createHarness', name: 'A', wireIds: ['w1'] });
  const twoWires = run(straight(straight(twoBlocks()), 'p2', 'p2'), { type: 'createHarness', name: 'B', wireIds: ['w1', 'w2'] });
  const both = { ...emptySelection(), blocks: ['b1', 'b2'] };
  [oneWire, twoWires].forEach(start => {
    const moved = apply(start, { type: 'moveItems', selection: both, delta: { x: 0, y: 100 } });
    const before = harnessArc(start, start.harnesses[0]);
    const after = harnessArc(moved, moved.harnesses[0]);
    assert.deepEqual(after.name, { x: before.name.x, y: before.name.y + 100 });
    assert.equal(after.start.y, before.start.y + 100);
  });
});

const bundleOfThree = () => straight(straight(straight(twoBlocks())));
const laneY = (project: Project, wireId: string) => displayPaths(project).get(wireId)![0].y;

test('a Harness marker crosses touching Wires at right angles and overhangs them', () => {
  const start = run(straight(straight(twoBlocks())), { type: 'createHarness', name: 'A', wireIds: ['w1', 'w2'] });
  const { start: a, end: b } = harnessArc(start, start.harnesses[0]);
  const ys = [laneY(start, 'w1'), laneY(start, 'w2')];
  assert.ok(Math.abs(ys[0] - ys[1]) - WIRE_WIDTH < 1e-9);
  assert.equal(a.x, b.x);
  assert.ok(Math.min(a.y, b.y) < Math.min(...ys) && Math.max(a.y, b.y) > Math.max(...ys));
});

test('a one-Wire Harness marker crosses its Wire at right angles', () => {
  const start = run(straight(twoBlocks()), { type: 'createHarness', name: 'A', wireIds: ['w1'] });
  const { start: a, end: b } = harnessArc(start, start.harnesses[0]);
  assert.equal(a.x, b.x);
  assert.ok(Math.min(a.y, b.y) < 320 && Math.max(a.y, b.y) > 320);
});

test('Wires outside a Harness sit clear of its marker, and its own Wires stay touching', () => {
  const start = run(bundleOfThree(), { type: 'createHarness', name: 'A', wireIds: ['w1', 'w3'] });
  const { start: a, end: b } = harnessArc(start, start.harnesses[0]);
  const [inA, inB, outside] = [laneY(start, 'w1'), laneY(start, 'w3'), laneY(start, 'w2')];
  assert.ok(Math.abs(Math.abs(inA - inB) - WIRE_WIDTH) < 1e-9);
  const low = Math.min(a.y, b.y);
  const high = Math.max(a.y, b.y);
  assert.ok(outside < low - WIRE_WIDTH || outside > high + WIRE_WIDTH);
  assert.deepEqual(start.wires.map(w => w.corners), [[], [], []]);
});

test('Wires with no Harness still touch', () => {
  const start = bundleOfThree();
  const ys = ['w1', 'w2', 'w3'].map(id => laneY(start, id)).sort((a, b) => a - b);
  assert.ok(Math.abs(ys[1] - ys[0] - WIRE_WIDTH) < 1e-9 && Math.abs(ys[2] - ys[1] - WIRE_WIDTH) < 1e-9);
});

const editPins = (project: Project, pins: Pin[]) =>
  apply(project, { type: 'updateBlock', blockId: 'b1', name: 'J1', label: '', pins });

test('adding Pins to a placed Block keeps its Pins and Wires and numbers the new ones', () => {
  const start = straight(twoBlocks());
  const before = start.blocks[0].pins;
  const edited = editPins(start, resizedPins(before, counts(0, 6), ['p1']));
  const pins = edited.blocks[0].pins;
  assert.deepEqual(pins.slice(0, 4), before);
  assert.deepEqual(pins.slice(4).map(p => [p.id, p.number, p.side, p.order]), [['p5', '5', 'right', 4], ['p6', '6', 'right', 5]]);
  assert.deepEqual(wirePath(edited, edited.wires[0])[0], { x: 400, y: 320 });
});

test('Pins can be added on a side that had none', () => {
  const pins = resizedPins(twoBlocks().blocks[0].pins, counts(1, 4, 2), []);
  assert.deepEqual(pins.slice(4).map(p => [p.number, p.side, p.order]), [['5', 'left', 0], ['6', 'top', 0], ['7', 'top', 1]]);
});

test('removing Pins takes unwired ones from the end and never a wired Pin', () => {
  const before = twoBlocks().blocks[0].pins;
  assert.equal(pinFloor(before, 'right', ['p2']), 2);
  assert.deepEqual(resizedPins(before, counts(0, 3), []).map(p => p.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(resizedPins(before, counts(0, 0), ['p2']).map(p => p.id), ['p1', 'p2']);
});

test('editing a rotated Block keeps its Pin order', () => {
  const rotated = apply(twoBlocks(), { type: 'rotateBlocks', blockIds: ['b1'] });
  assert.deepEqual(editPins(rotated, rotated.blocks[0].pins).blocks[0].pins, rotated.blocks[0].pins);
});

test('deleting a Block removes its Wires and empties Harnesses', () => {
  const start = run(straight(twoBlocks()), { type: 'createHarness', name: 'A', wireIds: ['w1'] });
  const after = apply(start, { type: 'deleteItems', selection: { ...emptySelection(), blocks: ['b1'] } });
  assert.deepEqual(after.wires, []);
  assert.deepEqual(after.harnesses, []);
});

test('dragging a Zone carries the Blocks and Notes whose centres are inside', () => {
  const start = run(
    twoBlocks(),
    { type: 'createZone', name: 'Front', x: 250, y: 250, w: 300, h: 300 },
    { type: 'createNote', text: 'hi', at: { x: 300, y: 500 } },
    { type: 'createNote', text: 'far', at: { x: 1500, y: 500 } },
  );
  const moved = apply(start, {
    type: 'moveItems',
    selection: { ...emptySelection(), zones: ['z1'] },
    delta: { x: 50, y: 0 },
  });
  assert.equal(moved.zones[0].x, 300);
  assert.equal(moved.blocks[0].x, 350);
  assert.equal(moved.blocks[1].x, 900);
  assert.equal(moved.notes[0].x, 350);
  assert.equal(moved.notes[1].x, 1500);
});

test('a Zone-only drag moves the Zone and leaves everything inside it, even with Zones overlapping', () => {
  const start = run(
    twoBlocks(),
    { type: 'createZone', name: 'Front', x: 250, y: 250, w: 300, h: 300 },
    { type: 'createZone', name: 'Overlap', x: 300, y: 280, w: 300, h: 300 },
    { type: 'createNote', text: 'hi', at: { x: 400, y: 500 } },
  );
  const moved = apply(start, {
    type: 'moveItems',
    selection: { ...emptySelection(), zones: ['z2'] },
    delta: { x: 500, y: 0 },
    zoneOnly: true,
  });
  assert.deepEqual(moved.zones.map(z => z.x), [250, 800]);
  assert.deepEqual(moved.blocks, start.blocks);
  assert.deepEqual(moved.notes, start.notes);
});

test('a Zone created around a selection surrounds its Blocks and Notes with a margin', () => {
  const start = run(twoBlocks(), { type: 'createNote', text: 'hi', at: { x: 500, y: 500 } });
  const selection = { ...emptySelection(), blocks: ['b1'], notes: ['n1'] };
  const zoned = apply(start, { type: 'createZoneAround', name: 'ECU', selection });
  assert.deepEqual(zoned.zones, [{ id: 'z1', name: 'ECU', x: 270, y: 250, w: 320, h: 310 }]);
  assert.equal(apply(start, { type: 'createZoneAround', name: 'ECU', selection: emptySelection() }), start);
});

const unfinished = () =>
  apply(twoBlocks(), {
    type: 'addWire',
    from: { blockId: 'b1', pinId: 'p1' },
    to: null,
    corners: [{ x: 600, y: 320 }, { x: 600, y: 500 }],
    colours: ['red'],
  });

test('an unfinished Wire ends at its last corner, and that end stays put when its Block moves', () => {
  const start = unfinished();
  assert.deepEqual(wirePath(start, start.wires[0]).at(-1), { x: 600, y: 500 });
  const moved = move(start, 'b1', 0, -40);
  assert.deepEqual(wirePath(moved, moved.wires[0]).at(-1), { x: 600, y: 500 });
  assert.deepEqual(wirePath(moved, moved.wires[0])[0], { x: 400, y: 280 });
});

test('sliding the last segment of an unfinished Wire moves its loose end', () => {
  const slid = apply(unfinished(), { type: 'slideSegment', wireId: 'w1', index: 1, delta: { x: 50, y: 0 } });
  assert.deepEqual(wirePath(slid, slid.wires[0]).at(-1), { x: 650, y: 500 });
});

test('an unfinished Wire can be resumed from its full route and finished on a Pin', () => {
  const start = unfinished();
  const draw = resumeDraw(start, start.wires[0]);
  assert.equal(draw.pts.length, 3);
  assert.deepEqual(draw.history.at(-1), draw.pts.slice(0, 2));
  const finished = apply(start, {
    type: 'setWireRoute',
    wireId: 'w1',
    to: { blockId: 'b2', pinId: 'p1' },
    corners: [{ x: 600, y: 320 }, { x: 600, y: 500 }, { x: 800, y: 500 }, { x: 800, y: 320 }],
  });
  assert.equal(finished.wires.length, 1);
  assert.deepEqual(wirePath(finished, finished.wires[0]).at(-1), { x: 900, y: 320 });
});

test('an unfinished Wire is copied with its start Block and deleted with it', () => {
  const start = unfinished();
  const selection = { ...emptySelection(), blocks: ['b1'] };
  const pasted = apply(start, { type: 'paste', clipboard: copyItems(start, selection), offset: { x: 40, y: 40 } });
  assert.equal(pasted.wires[1].to, null);
  assert.deepEqual(pasted.wires[1].corners[1], { x: 640, y: 540 });
  assert.deepEqual(apply(start, { type: 'deleteItems', selection }).wires, []);
});

test('colours: the base and second colour change independently', () => {
  const start = straight(twoBlocks());
  const two = apply(start, { type: 'setWireColours', wireIds: ['w1'], second: 'yellow' });
  assert.deepEqual(two.wires[0].colours, ['red', 'yellow']);
  const based = apply(two, { type: 'setWireColours', wireIds: ['w1'], base: 'green' });
  assert.deepEqual(based.wires[0].colours, ['green', 'yellow']);
  const single = apply(based, { type: 'setWireColours', wireIds: ['w1'], second: null });
  assert.deepEqual(single.wires[0].colours, ['green']);
});

test('the file is sorted by ID, stable, and round-trips', () => {
  const start = run(twoBlocks(), { type: 'createNote', text: 'a', at: { x: 0, y: 0 } });
  const shuffled = { ...start, blocks: [...start.blocks].reverse() };
  const text = serialize(shuffled);
  assert.equal(text, serialize(start));
  assert.deepEqual(parseProject(text), start);
  assert.deepEqual(parseProject(''), emptyProject());
});

test('undo and redo walk snapshots, and a new edit clears redo', () => {
  const a = emptyProject();
  const b = { ...a, notes: [{ id: 'n1', text: '', x: 0, y: 0 }] };
  const c = { ...a, notes: [{ id: 'n2', text: '', x: 0, y: 0 }] };
  const history = commit(startHistory(a), b);
  assert.equal(undo(history).present, a);
  assert.equal(redo(undo(history)).present, b);
  assert.deepEqual(commit(undo(history), c).future, []);
});
