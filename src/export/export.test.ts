import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, emptyProject, makePins, type Command } from '../project/project.ts';
import type { Point, Project } from '../project/types.ts';
import { exportWarnings, fromToRows, layoutBounds } from './export.ts';

const run = (project: Project, ...commands: Command[]): Project => commands.reduce(apply, project);
const counts = (left: number, right: number) => ({ left, right, top: 0, bottom: 0 });

const base = () => {
  const start = run(
    emptyProject(),
    { type: 'createBlock', name: 'J10', label: '', at: { x: 900, y: 300 }, pins: makePins(counts(4, 0)) },
    { type: 'createBlock', name: 'J2', label: 'Front ECU', at: { x: 300, y: 300 }, pins: makePins(counts(0, 12)) },
  );
  const j2 = start.blocks[1];
  return {
    ...start,
    blocks: [
      start.blocks[0],
      {
        ...j2,
        pins: j2.pins.map(p => (p.number === '3' ? { ...p, net: 'GND' } : p.number === '4' ? { ...p, net: 'GND', userName: 'Earth' } : p)),
      },
    ],
  };
};

const wire = (fromPin: string, toPin: string | null, colours: string[], corners: Point[] = []): Command => ({
  type: 'addWire',
  from: { blockId: 'b2', pinId: fromPin },
  to: toPin ? { blockId: 'b1', pinId: toPin } : null,
  corners,
  colours,
});

test('a row reads Block, Label, Pin number and name, with colours spelled out', () => {
  const [row] = fromToRows(run(base(), wire('p3', 'p1', ['green', 'yellow'])));
  assert.deepEqual(row, {
    from: 'J2 (Front ECU) : 3 GND',
    to: 'J10 : 1',
    colour: 'green/yellow',
    harness: '',
    fromZone: '',
    toZone: '',
  });
});

test('a user name is shown in place of the Net', () => {
  assert.equal(fromToRows(run(base(), wire('p4', 'p1', ['red'])))[0].from, 'J2 (Front ECU) : 4 Earth');
});

test('rows are sorted by Block then Pin, naturally', () => {
  const project = run(
    base(),
    { type: 'addWire', from: { blockId: 'b1', pinId: 'p1' }, to: { blockId: 'b2', pinId: 'p1' }, corners: [], colours: ['red'] },
    wire('p10', 'p2', ['red']),
    wire('p2', 'p3', ['red']),
  );
  assert.deepEqual(fromToRows(project).map(r => r.from), ['J2 (Front ECU) : 2', 'J2 (Front ECU) : 10', 'J10 : 1']);
});

test('rows carry the Harness and the Zone of each end', () => {
  const project = run(
    base(),
    wire('p1', 'p1', ['red']),
    { type: 'createHarness', name: 'Main', wireIds: ['w1'] },
    { type: 'createZone', name: 'Front', x: 250, y: 250, w: 300, h: 400 },
    { type: 'createZone', name: 'Rear', x: 850, y: 250, w: 300, h: 300 },
  );
  const [row] = fromToRows(project);
  assert.deepEqual([row.harness, row.fromZone, row.toZone], ['Main', 'Front', 'Rear']);
});

test('an unfinished Wire shows "unfinished" in To and is listed under Warnings', () => {
  const project = run(base(), wire('p3', null, ['red'], [{ x: 600, y: 360 }]));
  const [row] = fromToRows(project);
  assert.deepEqual([row.to, row.toZone], ['unfinished', '']);
  assert.deepEqual(exportWarnings(project), ['Unfinished Wire from J2 (Front ECU) : 3 GND']);
});

test('Warnings list Wires on leftover Pins and Wires passing over a Pin', () => {
  const start = run(base(), wire('p1', 'p1', ['red']));
  const leftover = {
    ...start,
    blocks: start.blocks.map(b => (b.id === 'b1' ? { ...b, pins: b.pins.map(p => (p.id === 'p1' ? { ...p, leftover: true as const } : p)) } : b)),
  };
  assert.deepEqual(exportWarnings(leftover), ['Wire on a Pin no longer on the board: J2 (Front ECU) : 1 to J10 : 1']);

  const crossed = run(
    start,
    { type: 'createBlock', name: 'J3', label: '', at: { x: 600, y: 100 }, pins: makePins(counts(1, 0)) },
    { type: 'moveItems', selection: { blocks: ['b3'], wires: [], notes: [], zones: [], harnesses: [] }, delta: { x: 0, y: 200 } },
  );
  assert.deepEqual(exportWarnings(crossed), ['Wire passes over a Pin: J2 (Front ECU) : 1 to J10 : 1']);
});

test('no Wires means no rows and no Warnings', () => {
  assert.deepEqual(fromToRows(base()), []);
  assert.deepEqual(exportWarnings(base()), []);
});

test('the bounds enclose Blocks, Notes, Zones and Wire corners with a margin', () => {
  const project = run(
    base(),
    wire('p1', null, ['red'], [{ x: 1500, y: 320 }]),
    { type: 'createNote', text: 'hi', at: { x: 100, y: 50 } },
    { type: 'createZone', name: 'Z', x: 200, y: 200, w: 100, h: 900 },
  );
  const b = layoutBounds(project);
  assert.ok(b.x < 100 && b.y < 50);
  assert.ok(b.x + b.w > 1500 && b.y + b.h > 1100);
});

test('an empty layout still has usable bounds', () => {
  const b = layoutBounds(emptyProject());
  assert.ok(b.w > 0 && b.h > 0);
});
