import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, emptyProject, makePins, serialize } from './project.ts';
import { projectFileName, readProjectFile } from './projectFile.ts';
import type { Project } from './types.ts';

const wired = (): Project => {
  const pins = makePins({ left: 1, right: 1, top: 0, bottom: 0 });
  const blocks = [
    { type: 'createBlock', name: 'J1', label: '', at: { x: 300, y: 300 }, pins },
    { type: 'createBlock', name: 'J2', label: '', at: { x: 900, y: 300 }, pins },
  ] as const;
  const withBlocks = blocks.reduce(apply, emptyProject());
  const withWire = apply(withBlocks, {
    type: 'addWire',
    from: { blockId: 'b1', pinId: 'p2' },
    to: { blockId: 'b2', pinId: 'p1' },
    corners: [],
    colours: ['red'],
  });
  return apply(withWire, { type: 'createHarness', name: 'Main', wireIds: ['w1'] });
};

const refused = (text: string) => assert.equal(readProjectFile(text).ok, false, text);

const edited = (change: (data: any) => object) => JSON.stringify(change(JSON.parse(serialize(wired()))));

test('a saved project reads back unchanged', () => {
  assert.deepEqual(readProjectFile(serialize(wired())), { ok: true, project: wired() });
});

test('a project saved before Zone distances existed reads with none', () => {
  const result = readProjectFile(edited(({ zoneDistances, ...rest }) => rest));
  assert.ok(result.ok);
  assert.deepEqual(result.project.zoneDistances, []);
});

test('text that is not a project is refused', () => {
  ['', 'not json', 'null', '[]', '{}', '{"version":1}'].forEach(refused);
});

test('an unknown version is refused', () => {
  refused(edited(data => ({ ...data, version: 2 })));
});

test('a list of the wrong shape is refused', () => {
  refused(edited(data => ({ ...data, zones: {} })));
  refused(edited(data => ({ ...data, zoneDistances: 'none' })));
  refused(edited(data => ({ ...data, blocks: [{ id: 'b1' }] })));
  refused(edited(data => ({ ...data, wires: [{ id: 'w1' }] })));
});

test('a Wire pointing at a missing Block or Pin is refused', () => {
  const withEnd = (end: object) => edited(data => ({ ...data, wires: [{ ...data.wires[0], to: end }] }));
  refused(withEnd({ blockId: 'b9', pinId: 'p1' }));
  refused(withEnd({ blockId: 'b2', pinId: 'p9' }));
});

test('an unfinished Wire is accepted', () => {
  assert.equal(readProjectFile(edited(data => ({ ...data, wires: [{ ...data.wires[0], to: null }] }))).ok, true);
});

test('a Harness naming a missing Wire is refused', () => {
  refused(edited(data => ({ ...data, harnesses: [{ ...data.harnesses[0], wireIds: ['w9'] }] })));
});

test('a null item in any list is refused', () => {
  ['blocks', 'wires', 'harnesses', 'zones', 'zoneDistances', 'notes', 'customColours'].forEach(key =>
    refused(edited(data => ({ ...data, [key]: [null] }))),
  );
});

test('items the canvas cannot draw are refused', () => {
  refused(edited(data => ({ ...data, harnesses: [{ ...data.harnesses[0], wireIds: [] }] })));
  refused(edited(({ harnesses: [{ arc, ...harness }], ...rest }) => ({ ...rest, harnesses: [harness] })));
  refused(edited(({ wires: [{ colours, ...wire }], ...rest }) => ({ ...rest, harnesses: [], wires: [wire] })));
  refused(edited(data => ({ ...data, blocks: data.blocks.map(({ x, ...block }: any) => block) })));
  refused(edited(data => ({
    ...data,
    blocks: data.blocks.map((b: any) => ({ ...b, pins: b.pins.map((p: any) => ({ ...p, side: 'middle' })) })),
  })));
});

test('IDs that cannot be sorted or are repeated are refused', () => {
  const note = { id: 'n1', text: 'x', x: 0, y: 0 };
  assert.equal(readProjectFile(edited(data => ({ ...data, notes: [note] }))).ok, true);
  refused(edited(data => ({ ...data, notes: [{ ...note, id: 7 }] })));
  refused(edited(data => ({ ...data, notes: [{ ...note, id: 'abc' }] })));
  refused(edited(data => ({ ...data, notes: [note, note] })));
});

test('a Zone distance naming a missing Zone is refused', () => {
  refused(edited(data => ({ ...data, zoneDistances: [{ zoneA: 'z1', zoneB: 'z2', mm: 100 }] })));
});

test('a file name ends in .json and has no path characters', () => {
  assert.equal(projectFileName('  car '), 'car.json');
  assert.equal(projectFileName('car.json'), 'car.json');
  assert.equal(projectFileName('a/b\\c:d'), 'a-b-c-d.json');
  assert.equal(projectFileName('   '), 'project.json');
});
