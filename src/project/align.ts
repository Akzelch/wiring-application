import { blockSize, noteSize, snap } from '../routing/routing.ts';
import { movingIds } from './project.ts';
import type { Point, Project, Selection } from './types.ts';

export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number };
type Rect = { x: number; y: number; w: number; h: number };
type Axis = 'x' | 'y';

const SNAP_DISTANCE = 25;
const SAME = 0.5;

const span = (r: Rect, axis: Axis) => (axis === 'x' ? { lo: r.x, size: r.w } : { lo: r.y, size: r.h });

const stops = (r: Rect, axis: Axis): number[] => {
  const { lo, size } = span(r, axis);
  return [lo, lo + size / 2, lo + size];
};

const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');

const alignOffset = (moving: Rect, targets: Rect[], axis: Axis): number | null =>
  stops(moving, axis)
    .flatMap(m => targets.flatMap(t => stops(t, axis).map(s => s - m)))
    .filter(offset => Math.abs(offset) <= SNAP_DISTANCE)
    .reduce<number | null>((best, offset) => (best === null || Math.abs(offset) < Math.abs(best) ? offset : best), null);

const settledDelta = (raw: number, offset: number | null): number => (offset === null ? snap(raw) : raw + offset);

const guidesOn = (moving: Rect, targets: Rect[], axis: Axis): Guide[] => {
  const mine = stops(moving, axis);
  const positions = [...new Set(targets.flatMap(t => stops(t, axis)))]
    .filter(at => mine.some(m => Math.abs(m - at) < SAME))
    .sort((a, b) => a - b);
  return positions.map(at => {
    const aligned = [moving, ...targets.filter(t => stops(t, axis).some(s => Math.abs(s - at) < SAME))];
    const across = aligned.map(r => span(r, other(axis)));
    return {
      axis,
      at,
      from: Math.min(...across.map(c => c.lo)),
      to: Math.max(...across.map(c => c.lo + c.size)),
    };
  });
};

const boundsOf = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map(r => r.x));
  const y = Math.min(...rects.map(r => r.y));
  return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
};

export const alignedMove = (
  project: Project,
  selection: Selection,
  delta: Point,
  zoneOnly: boolean,
): { delta: Point; guides: Guide[] } => {
  const { blockIds, noteIds } = movingIds(project, selection, zoneOnly);
  const blocks = project.blocks.map(b => ({ moving: blockIds.has(b.id), rect: { x: b.x, y: b.y, ...blockSize(b) } }));
  const notes = project.notes.map(n => ({ moving: noteIds.has(n.id), rect: { x: n.x, y: n.y, ...noteSize(n) } }));
  const zones = project.zones.map(({ x, y, w, h, id }) => ({ moving: selection.zones.includes(id), rect: { x, y, w, h } }));
  const items = [...blocks, ...notes, ...zones];
  const movers = items.filter(i => i.moving).map(i => i.rect);
  if (movers.length === 0) return { delta: { x: snap(delta.x), y: snap(delta.y) }, guides: [] };
  const targets = items.filter(i => !i.moving).map(i => i.rect);
  const start = boundsOf(movers);
  const dragged = { ...start, x: start.x + delta.x, y: start.y + delta.y };
  const finalDelta = {
    x: settledDelta(delta.x, alignOffset(dragged, targets, 'x')),
    y: settledDelta(delta.y, alignOffset(dragged, targets, 'y')),
  };
  const landed = { ...start, x: start.x + finalDelta.x, y: start.y + finalDelta.y };
  return { delta: finalDelta, guides: [...guidesOn(landed, targets, 'x'), ...guidesOn(landed, targets, 'y')] };
};
