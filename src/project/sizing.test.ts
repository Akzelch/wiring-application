import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockSize, displayPaths, GRID, pinPoint, wirePath } from '../routing/routing.ts';
import { wireWidth } from './gauge.ts';
import { apply, emptyProject, emptySelection, makePins, parseProject, zoneDistance, type Command } from './project.ts';
import type { Project } from './types.ts';

const run = (project: Project, ...commands: Command[]): Project => commands.reduce(apply, project);
const pins = (left: number, right: number) => makePins({ left, right, top: 0, bottom: 0 });

const wired = () =>
  run(
    emptyProject(),
    { type: 'createBlock', name: 'J1', label: '', at: { x: 300, y: 300 }, pins: pins(0, 4) },
    { type: 'createBlock', name: 'J2', label: '', at: { x: 900, y: 300 }, pins: pins(4, 0) },
    { type: 'addWire', from: { blockId: 'b1', pinId: 'p1' }, to: { blockId: 'b2', pinId: 'p1' }, corners: [], colours: ['red'], gauge: 1.5 },
    { type: 'addWire', from: { blockId: 'b1', pinId: 'p1' }, to: { blockId: 'b2', pinId: 'p1' }, corners: [], colours: ['blue'] },
  );

test('a new Wire keeps its size, and a Wire without one stores nothing', () => {
  const [sized, plain] = wired().wires;
  assert.equal(sized.gauge, 1.5);
  assert.equal('gauge' in plain, false);
});

test('setting a size applies to the chosen Wires and clearing removes it', () => {
  const set = run(wired(), { type: 'setWireGauge', wireIds: ['w2'], gauge: 4 });
  assert.deepEqual(set.wires.map(w => w.gauge), [1.5, 4]);
  const cleared = run(set, { type: 'setWireGauge', wireIds: ['w1'] });
  assert.equal('gauge' in cleared.wires[0], false);
});

test('stepping moves each chosen Wire from its own size', () => {
  const stepped = run(wired(), { type: 'stepWireGauge', wireIds: ['w1', 'w2'], step: 1 });
  assert.deepEqual(stepped.wires.map(w => w.gauge), [2.5, 0.14]);
});

test('overlapping Wires of different sizes are drawn exactly touching', () => {
  const project = wired();
  const paths = displayPaths(project);
  const gap = Math.abs(paths.get('w1')![0].y - paths.get('w2')![0].y);
  assert.ok(Math.abs(gap - (wireWidth(1.5) + wireWidth(undefined)) / 2) < 1e-9);
});

test('a scaled Block grows with its Pin spacing, keeps Pins on the grid, and its Wires follow', () => {
  const before = wired();
  const block = before.blocks[0];
  const after = run(before, { type: 'updateBlock', blockId: 'b1', name: 'J1', label: '', pins: block.pins, scale: 1.5 });
  const scaled = after.blocks[0];
  assert.deepEqual(blockSize(scaled), { w: blockSize(block).w * 1.5, h: blockSize(block).h * 1.5 });
  assert.ok(scaled.pins.every(p => pinPoint(scaled, p).y % GRID === 0));
  assert.deepEqual(wirePath(after, after.wires[0])[0], pinPoint(scaled, scaled.pins[0]));
});

test('a later edit without a scale leaves the scale alone', () => {
  const start = run(emptyProject(), { type: 'createBlock', name: 'J1', label: '', at: { x: 0, y: 0 }, pins: pins(0, 1), scale: 2 });
  const edited = run(start, { type: 'updateBlock', blockId: 'b1', name: 'J1', label: 'x', pins: start.blocks[0].pins });
  assert.equal(edited.blocks[0].scale, 2);
});

const zoned = () =>
  run(
    emptyProject(),
    { type: 'createZone', name: 'A', x: 0, y: 0, w: 100, h: 100 },
    { type: 'createZone', name: 'B', x: 200, y: 0, w: 100, h: 100 },
    { type: 'setZoneDistance', zoneA: 'z1', zoneB: 'z2', mm: 800 },
  );

test('a Zone distance reads the same in either direction and can be replaced or cleared', () => {
  assert.equal(zoneDistance(zoned(), 'z2', 'z1'), 800);
  const replaced = run(zoned(), { type: 'setZoneDistance', zoneA: 'z2', zoneB: 'z1', mm: 900 });
  assert.deepEqual(replaced.zoneDistances.map(d => d.mm), [900]);
  assert.deepEqual(run(zoned(), { type: 'setZoneDistance', zoneA: 'z1', zoneB: 'z2' }).zoneDistances, []);
});

test('deleting a Zone removes its distances', () => {
  const after = run(zoned(), { type: 'deleteItems', selection: { ...emptySelection(), zones: ['z1'] } });
  assert.deepEqual(after.zoneDistances, []);
});

test('a project saved before Zone distances still loads', () => {
  const { zoneDistances: _zoneDistances, ...old } = emptyProject();
  assert.deepEqual(parseProject(JSON.stringify(old)).zoneDistances, []);
});
