import {
  blockCentre,
  blockSize,
  clean,
  followPins,
  harnessMidpoint,
  inZone,
  noteCentre,
  noteSize,
  passesOverPin,
  slidCorners,
  snap,
  wirePath,
} from '../routing/routing.ts';
import type { Block, Colour, Note, Pin, Point, Project, Selection, Side, Wire, WireEnd, Zone } from './types.ts';

export const PALETTE: Colour[] = [
  { name: 'black', hex: '#222222' },
  { name: 'brown', hex: '#8b4513' },
  { name: 'red', hex: '#d22222' },
  { name: 'orange', hex: '#e07b00' },
  { name: 'yellow', hex: '#d4c000' },
  { name: 'green', hex: '#1e9e3a' },
  { name: 'blue', hex: '#2257d6' },
  { name: 'violet', hex: '#7c2fc4' },
  { name: 'grey', hex: '#808080' },
  { name: 'white', hex: '#f4f4f4' },
  { name: 'pink', hex: '#ee5f9d' },
];

const ZONE_MARGIN = 30;
const ZONE_TITLE = 22;

export const emptyProject = (): Project => ({
  version: 1,
  blocks: [],
  wires: [],
  harnesses: [],
  zones: [],
  notes: [],
  customColours: [],
});

export const emptySelection = (): Selection => ({ blocks: [], wires: [], notes: [], zones: [], harnesses: [] });

export const colourHex = (project: Project, name: string): string =>
  [...PALETTE, ...project.customColours].find(c => c.name === name)?.hex ?? '#000000';

export const pinLabel = (p: Pin): string => p.userName || p.net || p.number;

export const makePins = (counts: Record<Side, number>): Pin[] => {
  const sides: Side[] = ['left', 'right', 'top', 'bottom'];
  const slots = sides.flatMap(side => Array.from({ length: counts[side] }, (_, order) => ({ side, order })));
  return slots.map(({ side, order }, i) => ({
    id: `p${i + 1}`,
    number: String(i + 1),
    net: '',
    userName: '',
    side,
    order,
  }));
};

export const nameTaken = (project: Project, name: string, exceptId?: string): boolean =>
  project.blocks.some(b => b.name === name && b.id !== exceptId);

export const nextFreeName = (used: string[], name: string): string => {
  const match = /^(.*?)(\d+)$/.exec(name);
  const base = match ? match[1] : name;
  const start = match ? Number(match[2]) + 1 : 2;
  const search = (n: number): string => (used.includes(`${base}${n}`) ? search(n + 1) : `${base}${n}`);
  return search(start);
};

export type Clipboard = { blocks: Block[]; wires: Wire[]; notes: Note[] };

export type Command =
  | { type: 'createBlock'; name: string; label: string; at: Point; pins: Pin[] }
  | { type: 'updateBlock'; blockId: string; name: string; label: string; pins: Pin[] }
  | { type: 'rotateBlocks'; blockIds: string[] }
  | { type: 'moveItems'; selection: Selection; delta: Point }
  | { type: 'deleteItems'; selection: Selection }
  | { type: 'addWire'; from: WireEnd; to: WireEnd | null; corners: Point[]; colours: string[] }
  | { type: 'setWireRoute'; wireId: string; to: WireEnd | null; corners: Point[] }
  | { type: 'slideSegment'; wireId: string; index: number; delta: Point }
  | { type: 'setWireColours'; wireIds: string[]; base?: string; second?: string | null }
  | { type: 'addCustomColour'; colour: Colour }
  | { type: 'createHarness'; name: string; wireIds: string[] }
  | { type: 'renameHarness'; harnessId: string; name: string }
  | { type: 'moveHarness'; harnessId: string; arc: Point }
  | { type: 'createZone'; name: string; x: number; y: number; w: number; h: number }
  | { type: 'createZoneAround'; name: string; selection: Selection }
  | { type: 'updateZone'; zoneId: string; changes: Partial<Omit<Zone, 'id'>> }
  | { type: 'createNote'; text: string; at: Point }
  | { type: 'updateNote'; noteId: string; text: string }
  | { type: 'paste'; clipboard: Clipboard; offset: Point };

const numberOf = (id: string) => Number(id.replace(/^\D+/, ''));

export const nextId = (prefix: string, items: { id: string }[]): string =>
  `${prefix}${Math.max(0, ...items.map(i => numberOf(i.id))) + 1}`;

export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

const normaliseOrders = (pins: Pin[]): Pin[] => {
  const orderInSide = (pin: Pin, index: number) =>
    pins.slice(0, index).filter(p => p.side === pin.side).length;
  return pins.map((p, i) => ({ ...p, order: orderInSide(p, i) }));
};

const replaced = <T extends { id: string }>(items: T[], id: string, change: (item: T) => T): T[] =>
  items.map(i => (i.id === id ? change(i) : i));

const withFollowedWires = (before: Project, after: Project): Project => ({
  ...after,
  wires: followPins(before, after),
});

const rotatedSide: Record<Side, Side> = { top: 'right', right: 'bottom', bottom: 'left', left: 'top' };
const reversesOrder: Record<Side, boolean> = { left: true, right: true, top: false, bottom: false };

const rotateBlock = (b: Block): Block => {
  const countOn = (side: Side) => b.pins.filter(p => p.side === side).length;
  const pins = b.pins.map(p => ({
    ...p,
    side: rotatedSide[p.side],
    order: reversesOrder[p.side] ? countOn(p.side) - 1 - p.order : p.order,
  }));
  const centre = blockCentre(b);
  const rotated = { ...b, pins };
  const { w, h } = blockSize(rotated);
  return { ...rotated, x: snap(centre.x - w / 2), y: snap(centre.y - h / 2) };
};

const moveItems = (project: Project, selection: Selection, delta: Point): Project => {
  const zones = project.zones.filter(z => selection.zones.includes(z.id));
  const blockIds = new Set([
    ...selection.blocks,
    ...project.blocks.filter(b => zones.some(z => inZone(z, blockCentre(b)))).map(b => b.id),
  ]);
  const noteIds = new Set([
    ...selection.notes,
    ...project.notes.filter(n => zones.some(z => inZone(z, noteCentre(n)))).map(n => n.id),
  ]);
  const shift = <T extends Point>(item: T): T => ({ ...item, x: item.x + delta.x, y: item.y + delta.y });
  return withFollowedWires(project, {
    ...project,
    blocks: project.blocks.map(b => (blockIds.has(b.id) ? shift(b) : b)),
    notes: project.notes.map(n => (noteIds.has(n.id) ? shift(n) : n)),
    zones: project.zones.map(z => (selection.zones.includes(z.id) ? shift(z) : z)),
  });
};

const pruneHarnesses = (project: Project, keepWire: (id: string) => boolean): Project => ({
  ...project,
  harnesses: project.harnesses
    .map(h => ({ ...h, wireIds: h.wireIds.filter(keepWire) }))
    .filter(h => h.wireIds.length > 0),
});

const deleteItems = (project: Project, s: Selection): Project => {
  const wires = project.wires.filter(
    w => !s.wires.includes(w.id) && !s.blocks.includes(w.from.blockId) && !(w.to && s.blocks.includes(w.to.blockId)),
  );
  const liveWires = new Set(wires.map(w => w.id));
  return pruneHarnesses(
    {
      ...project,
      blocks: project.blocks.filter(b => !s.blocks.includes(b.id)),
      wires,
      notes: project.notes.filter(n => !s.notes.includes(n.id)),
      zones: project.zones.filter(z => !s.zones.includes(z.id)),
      harnesses: project.harnesses.filter(h => !s.harnesses.includes(h.id)),
    },
    id => liveWires.has(id),
  );
};

export const copyItems = (project: Project, s: Selection): Clipboard => ({
  blocks: project.blocks.filter(b => s.blocks.includes(b.id)),
  wires: project.wires.filter(w => s.blocks.includes(w.from.blockId) && (!w.to || s.blocks.includes(w.to.blockId))),
  notes: project.notes.filter(n => s.notes.includes(n.id)),
});

const paste = (project: Project, clipboard: Clipboard, offset: Point): Project => {
  const shift = <T extends Point>(p: T): T => ({ ...p, x: p.x + offset.x, y: p.y + offset.y });
  const blocks = clipboard.blocks.reduce<Block[]>((all, b) => {
    const id = nextId('b', all);
    return [
      ...all,
      {
        ...shift(b),
        id,
        name: nextFreeName(all.map(x => x.name), b.name),
        kicadLinked: false,
        pins: b.pins.map(({ leftover: _leftover, ...pin }) => pin),
      },
    ];
  }, project.blocks);
  const added = blocks.slice(project.blocks.length);
  const blockIdMap = new Map(clipboard.blocks.map((b, i) => [b.id, added[i].id]));
  const wires = clipboard.wires.reduce<Wire[]>(
    (all, w) => [
      ...all,
      {
        ...w,
        id: nextId('w', all),
        from: { ...w.from, blockId: blockIdMap.get(w.from.blockId)! },
        to: w.to && { ...w.to, blockId: blockIdMap.get(w.to.blockId)! },
        corners: w.corners.map(shift),
      },
    ],
    project.wires,
  );
  const notes = clipboard.notes.reduce<Note[]>(
    (all, n) => [...all, { ...shift(n), id: nextId('n', all) }],
    project.notes,
  );
  return { ...project, blocks, wires, notes };
};

export const apply = (project: Project, command: Command): Project => {
  switch (command.type) {
    case 'createBlock': {
      if (nameTaken(project, command.name)) return project;
      const block: Block = {
        id: nextId('b', project.blocks),
        name: command.name,
        label: command.label,
        kicadLinked: false,
        x: command.at.x,
        y: command.at.y,
        pins: normaliseOrders(command.pins),
      };
      return { ...project, blocks: [...project.blocks, block] };
    }
    case 'updateBlock': {
      if (nameTaken(project, command.name, command.blockId)) return project;
      return withFollowedWires(project, {
        ...project,
        blocks: replaced(project.blocks, command.blockId, b => ({
          ...b,
          name: b.kicadLinked ? b.name : command.name,
          label: command.label,
          pins: normaliseOrders(command.pins),
        })),
      });
    }
    case 'rotateBlocks':
      return withFollowedWires(project, {
        ...project,
        blocks: project.blocks.map(b => (command.blockIds.includes(b.id) ? rotateBlock(b) : b)),
      });
    case 'moveItems':
      return moveItems(project, command.selection, command.delta);
    case 'deleteItems':
      return deleteItems(project, command.selection);
    case 'addWire': {
      const wire: Wire = {
        id: nextId('w', project.wires),
        from: command.from,
        to: command.to,
        corners: command.corners,
        colours: command.colours,
      };
      return { ...project, wires: [...project.wires, wire] };
    }
    case 'setWireRoute':
      return {
        ...project,
        wires: replaced(project.wires, command.wireId, w => ({ ...w, to: command.to, corners: command.corners })),
      };
    case 'slideSegment': {
      const wire = project.wires.find(w => w.id === command.wireId)!;
      const slid = { ...wire, corners: slidCorners(project, wire, command.index, command.delta) };
      if (passesOverPin(project, clean(wirePath(project, slid)))) return project;
      return { ...project, wires: replaced(project.wires, wire.id, () => slid) };
    }
    case 'setWireColours':
      return {
        ...project,
        wires: project.wires.map(w => {
          if (!command.wireIds.includes(w.id)) return w;
          const base = command.base ?? w.colours[0];
          const second = command.second === undefined ? w.colours[1] : command.second;
          return { ...w, colours: second ? [base, second] : [base] };
        }),
      };
    case 'addCustomColour':
      return [...PALETTE, ...project.customColours].some(c => c.name === command.colour.name)
        ? project
        : { ...project, customColours: [...project.customColours, command.colour] };
    case 'createHarness': {
      if (command.wireIds.length === 0) return project;
      const pruned = pruneHarnesses(project, id => !command.wireIds.includes(id));
      const first = project.wires.find(w => w.id === command.wireIds[0])!;
      return {
        ...pruned,
        harnesses: [
          ...pruned.harnesses,
          {
            id: nextId('h', project.harnesses),
            name: command.name,
            wireIds: command.wireIds,
            arc: harnessMidpoint(project, first),
          },
        ],
      };
    }
    case 'renameHarness':
      return { ...project, harnesses: replaced(project.harnesses, command.harnessId, h => ({ ...h, name: command.name })) };
    case 'moveHarness':
      return { ...project, harnesses: replaced(project.harnesses, command.harnessId, h => ({ ...h, arc: command.arc })) };
    case 'createZone': {
      const { type: _type, ...zone } = command;
      return { ...project, zones: [...project.zones, { id: nextId('z', project.zones), ...zone }] };
    }
    case 'createZoneAround': {
      const boxes = [
        ...project.blocks.filter(b => command.selection.blocks.includes(b.id)).map(b => ({ ...blockSize(b), x: b.x, y: b.y })),
        ...project.notes.filter(n => command.selection.notes.includes(n.id)).map(n => ({ ...noteSize(n), x: n.x, y: n.y })),
      ];
      if (boxes.length === 0) return project;
      const x = snap(Math.min(...boxes.map(b => b.x)) - ZONE_MARGIN);
      const y = snap(Math.min(...boxes.map(b => b.y)) - ZONE_MARGIN - ZONE_TITLE);
      const right = snap(Math.max(...boxes.map(b => b.x + b.w)) + ZONE_MARGIN);
      const bottom = snap(Math.max(...boxes.map(b => b.y + b.h)) + ZONE_MARGIN);
      const zone = { id: nextId('z', project.zones), name: command.name, x, y, w: right - x, h: bottom - y };
      return { ...project, zones: [...project.zones, zone] };
    }
    case 'updateZone':
      return { ...project, zones: replaced(project.zones, command.zoneId, z => ({ ...z, ...command.changes })) };
    case 'createNote':
      return {
        ...project,
        notes: [...project.notes, { id: nextId('n', project.notes), text: command.text, ...command.at }],
      };
    case 'updateNote':
      return { ...project, notes: replaced(project.notes, command.noteId, n => ({ ...n, text: command.text })) };
    case 'paste':
      return paste(project, command.clipboard, command.offset);
  }
};

export const newItems = (before: Project, after: Project): Selection => {
  const fresh = (next: { id: string }[], old: { id: string }[]) =>
    next.filter(i => !old.some(o => o.id === i.id)).map(i => i.id);
  return {
    blocks: fresh(after.blocks, before.blocks),
    wires: fresh(after.wires, before.wires),
    notes: fresh(after.notes, before.notes),
    zones: fresh(after.zones, before.zones),
    harnesses: fresh(after.harnesses, before.harnesses),
  };
};

const byId = <T extends { id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => numberOf(a.id) - numberOf(b.id));

export const serialize = (project: Project): string =>
  `${JSON.stringify(
    {
      ...project,
      blocks: byId(project.blocks).map(b => ({ ...b, pins: byId(b.pins) })),
      wires: byId(project.wires),
      harnesses: byId(project.harnesses).map(h => ({
        ...h,
        wireIds: [...h.wireIds].sort((a, b) => numberOf(a) - numberOf(b)),
      })),
      zones: byId(project.zones),
      notes: byId(project.notes),
      customColours: [...project.customColours].sort((a, b) => a.name.localeCompare(b.name)),
    },
    null,
    2,
  )}\n`;

export const parseProject = (text: string): Project => (text.trim() === '' ? emptyProject() : JSON.parse(text));

export type History = { past: Project[]; present: Project; future: Project[] };

export const startHistory = (project: Project): History => ({ past: [], present: project, future: [] });

export const commit = (history: History, next: Project): History =>
  next === history.present
    ? history
    : { past: [...history.past, history.present], present: next, future: [] };

export const undo = (history: History): History =>
  history.past.length === 0
    ? history
    : {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1],
        future: [history.present, ...history.future],
      };

export const redo = (history: History): History =>
  history.future.length === 0
    ? history
    : { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
