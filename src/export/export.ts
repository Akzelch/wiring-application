import { naturalCompare } from '../project/project.ts';
import type { Point, Project, Wire, WireEnd } from '../project/types.ts';
import { blockCentre, blockSize, clean, inZone, noteSize, onLeftoverPin, passesOverPin, wirePath } from '../routing/routing.ts';

export type FromToRow = {
  from: string;
  to: string;
  colour: string;
  harness: string;
  fromZone: string;
  toZone: string;
};

const UNFINISHED = 'unfinished';

const endOf = (project: Project, end: WireEnd) => {
  const block = project.blocks.find(b => b.id === end.blockId)!;
  return { block, pin: block.pins.find(p => p.id === end.pinId)! };
};

const endText = (project: Project, end: WireEnd | null): string => {
  if (!end) return UNFINISHED;
  const { block, pin } = endOf(project, end);
  const name = block.label ? `${block.name} (${block.label})` : block.name;
  const pinName = pin.userName || pin.net;
  return `${name} : ${pinName ? `${pin.number} ${pinName}` : pin.number}`;
};

const zoneText = (project: Project, end: WireEnd | null): string => {
  if (!end) return '';
  const centre = blockCentre(endOf(project, end).block);
  return project.zones.filter(z => inZone(z, centre)).map(z => z.name).join(', ');
};

const sortedWires = (project: Project): Wire[] => {
  const key = (w: Wire) => {
    const { block, pin } = endOf(project, w.from);
    return { block: block.name, pin: pin.number, to: endText(project, w.to) };
  };
  return [...project.wires].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return naturalCompare(ka.block, kb.block) || naturalCompare(ka.pin, kb.pin) || naturalCompare(ka.to, kb.to);
  });
};

export const fromToRows = (project: Project): FromToRow[] =>
  sortedWires(project).map(w => ({
    from: endText(project, w.from),
    to: endText(project, w.to),
    colour: w.colours.join('/'),
    harness: project.harnesses.find(h => h.wireIds.includes(w.id))?.name ?? '',
    fromZone: zoneText(project, w.from),
    toZone: zoneText(project, w.to),
  }));

export const exportWarnings = (project: Project): string[] =>
  sortedWires(project).flatMap(w => {
    const route = `${endText(project, w.from)} to ${endText(project, w.to)}`;
    return [
      ...(w.to ? [] : [`Unfinished Wire from ${endText(project, w.from)}`]),
      ...(onLeftoverPin(project, w) ? [`Wire on a Pin no longer on the board: ${route}`] : []),
      ...(passesOverPin(project, clean(wirePath(project, w))) ? [`Wire passes over a Pin: ${route}`] : []),
    ];
  });

const MARGIN = 40;
const EMPTY_BOUNDS = { x: 0, y: 0, w: 1600, h: 1000 };

export const layoutBounds = (project: Project): { x: number; y: number; w: number; h: number } => {
  const box = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y: y + h }];
  const points = [
    ...project.blocks.flatMap(b => box(b.x, b.y, blockSize(b).w, blockSize(b).h)),
    ...project.notes.flatMap(n => box(n.x, n.y, noteSize(n).w, noteSize(n).h)),
    ...project.zones.flatMap(z => box(z.x, z.y, z.w, z.h)),
    ...project.wires.flatMap(w => wirePath(project, w)),
    ...project.harnesses.map(h => h.arc),
  ];
  if (points.length === 0) return EMPTY_BOUNDS;
  const x = Math.min(...points.map(p => p.x)) - MARGIN;
  const y = Math.min(...points.map(p => p.y)) - MARGIN;
  return {
    x,
    y,
    w: Math.max(...points.map(p => p.x)) + MARGIN - x,
    h: Math.max(...points.map(p => p.y)) + MARGIN - y,
  };
};
