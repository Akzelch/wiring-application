import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignedMove } from './align.ts';
import { apply, emptyProject, emptySelection, makePins, type Command } from './project.ts';
import type { Project } from './types.ts';

const run = (project: Project, ...commands: Command[]): Project => commands.reduce(apply, project);

const twoBlocks = () =>
  run(
    emptyProject(),
    { type: 'createBlock', name: 'A', label: '', at: { x: 300, y: 300 }, pins: makePins({ left: 0, right: 0, top: 9, bottom: 0 }) },
    { type: 'createBlock', name: 'B', label: '', at: { x: 900, y: 100 }, pins: makePins({ left: 0, right: 4, top: 0, bottom: 0 }) },
  );
const b = { ...emptySelection(), blocks: ['b2'] };

test('a near edge snaps and shows a guide spanning the aligned items', () => {
  assert.deepEqual(alignedMove(twoBlocks(), b, { x: -596, y: 0 }, true), {
    delta: { x: -600, y: 0 },
    guides: [
      { axis: 'x', at: 300, from: 100, to: 360 },
      { axis: 'x', at: 400, from: 100, to: 360 },
    ],
  });
});

test('horizontal edges snap too', () => {
  assert.deepEqual(alignedMove(twoBlocks(), b, { x: 0, y: 196 }, true), {
    delta: { x: 0, y: 200 },
    guides: [{ axis: 'y', at: 300, from: 300, to: 1000 }],
  });
});

test('centres align with centres', () => {
  const { delta, guides } = alignedMove(twoBlocks(), b, { x: -547, y: 0 }, true);
  assert.equal(delta.x, -550);
  assert.ok(guides.some(g => g.axis === 'x' && g.at === 400));
});

test('an aligned item holds until pulled clearly past the alignment, then returns to the grid', () => {
  assert.equal(alignedMove(twoBlocks(), b, { x: -585, y: 0 }, true).delta.x, -600);
  assert.equal(alignedMove(twoBlocks(), b, { x: -615, y: 0 }, true).delta.x, -600);
  assert.equal(alignedMove(twoBlocks(), b, { x: -376, y: 0 }, true).delta.x, -400);
  assert.deepEqual(alignedMove(twoBlocks(), b, { x: -374, y: 0 }, true), { delta: { x: -370, y: 0 }, guides: [] });
});

test('nothing snaps when no edge is near', () => {
  assert.deepEqual(alignedMove(twoBlocks(), b, { x: -340, y: 0 }, true), { delta: { x: -340, y: 0 }, guides: [] });
});

test('items being moved are not alignment targets', () => {
  const both = { ...emptySelection(), blocks: ['b1', 'b2'] };
  assert.deepEqual(alignedMove(twoBlocks(), both, { x: 3, y: 3 }, true), { delta: { x: 0, y: 0 }, guides: [] });
});

test('Notes are alignment targets', () => {
  const project = apply(twoBlocks(), { type: 'createNote', text: 'hi', at: { x: 703, y: 500 } });
  assert.equal(alignedMove(project, b, { x: -200, y: 0 }, true).delta.x, -197);
});

test('a Zone aligns with what is inside it only when it leaves its contents behind', () => {
  const project = apply(twoBlocks(), { type: 'createZone', name: 'Z', x: 200, y: 200, w: 400, h: 200 });
  const zone = { ...emptySelection(), zones: ['z1'] };
  assert.equal(alignedMove(project, zone, { x: 93, y: 0 }, false).delta.x, 90);
  assert.equal(alignedMove(project, zone, { x: 93, y: 0 }, true).delta.x, 100);
});
