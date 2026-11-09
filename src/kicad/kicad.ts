import { naturalCompare, nextId } from '../project/project.ts';
import type { Block, Pin, Project, Wire } from '../project/types.ts';
import { blockSize, followPins, snap } from '../routing/routing.ts';

export type Connector = { reference: string; pins: { number: string; net: string }[] };
export type ChecklistEntry = { reference: string; pinCount: number; ticked: boolean; clash: boolean };
export type ImportReport = {
  orphanedWires: { wireId: string; block: string; pin: string }[];
  missingBlocks: string[];
};

type Expr = string | Expr[];

const TOKEN = /"(?:[^"\\]|\\.)*"|[()]|[^\s()"]+/g;

const parseExpr = (text: string): Expr[] => {
  // Appends to local lists: copying them per token would be quadratic on a 1 MB board.
  const root: Expr[] = [];
  const open: Expr[][] = [root];
  for (const [token] of text.matchAll(TOKEN)) {
    const top = open[open.length - 1];
    if (token === '(') {
      const list: Expr[] = [];
      top.push(list);
      open.push(list);
    } else if (token === ')') {
      open.pop();
    } else {
      top.push(token.startsWith('"') ? token.slice(1, -1).replace(/\\(.)/g, '$1') : token);
    }
  }
  return root;
};

const lists = (expr: Expr[]): Expr[][] => expr.filter((e): e is Expr[] => Array.isArray(e));
const child = (expr: Expr[], head: string) => lists(expr).find(e => e[0] === head);

const referenceOf = (footprint: Expr[]): string => {
  const items = lists(footprint);
  const property = items.find(e => e[0] === 'property' && e[1] === 'Reference');
  const text = items.find(e => e[0] === 'fp_text' && e[1] === 'reference');
  return String(property?.[2] ?? text?.[2] ?? '');
};

const cleanNet = (raw: string): string =>
  raw.startsWith('unconnected-') ? '' : raw.replace(/^\//, '').replaceAll('{slash}', '/');

const netOf = (pad: Expr[]): string => {
  const net = child(pad, 'net');
  return net ? cleanNet(String(net[net.length - 1])) : '';
};

const pinsOf = (footprint: Expr[]): Connector['pins'] => {
  const pads = lists(footprint).filter(e => e[0] === 'pad' && e[1] !== '' && e[2] !== 'np_thru_hole');
  const numbers = [...new Set(pads.map(p => String(p[1])))].sort(naturalCompare);
  return numbers.map(number => {
    const nets = pads.filter(p => p[1] === number).map(netOf);
    return { number, net: nets.find(n => n !== '') ?? '' };
  });
};

export const readConnectors = (text: string): Connector[] => {
  const [board] = lists(parseExpr(text));
  const footprints = lists(board).filter(e => e[0] === 'footprint');
  const references = footprints.map(referenceOf);
  const unique = (r: string) => r !== '' && references.indexOf(r) === references.lastIndexOf(r);
  return footprints
    .filter(f => unique(referenceOf(f)))
    .map(f => ({ reference: referenceOf(f), pins: pinsOf(f) }))
    .filter(c => c.pins.length > 0)
    .sort((a, b) => naturalCompare(a.reference, b.reference));
};

const isClash = (project: Project, reference: string) =>
  project.blocks.some(b => !b.kicadLinked && b.name === reference);

const linkedBlock = (project: Project, reference: string) =>
  project.blocks.find(b => b.kicadLinked && b.name === reference);

export const checklist = (project: Project, connectors: Connector[]): ChecklistEntry[] =>
  connectors.map(({ reference, pins }) => {
    const clash = isClash(project, reference);
    return {
      reference,
      pinCount: pins.length,
      clash,
      ticked: !clash && (reference.startsWith('J') || linkedBlock(project, reference) !== undefined),
    };
  });

const touches = (w: Wire, blockId: string, pinId: string) =>
  (w.from.blockId === blockId && w.from.pinId === pinId) || (w.to?.blockId === blockId && w.to.pinId === pinId);

const closeUp = (pins: Pin[]): Pin[] =>
  pins.map(p => ({ ...p, order: pins.filter(q => q.side === p.side && q.order < p.order).length }));

const IMPORT_SIDE = 'left';

const mergedPins = (block: Block, connector: Connector, wires: Wire[]): Pin[] => {
  const kept = block.pins.flatMap((pin): Pin[] => {
    const match = connector.pins.find(c => c.number === pin.number);
    if (match) {
      const { leftover: _leftover, ...rest } = pin;
      return [{ ...rest, net: match.net }];
    }
    return wires.some(w => touches(w, block.id, pin.id)) ? [{ ...pin, leftover: true }] : [];
  });
  const firstFree = Math.max(-1, ...kept.filter(p => p.side === IMPORT_SIDE).map(p => p.order)) + 1;
  const added = connector.pins
    .filter(c => !block.pins.some(p => p.number === c.number))
    .reduce<Pin[]>(
      (all, c, i) => [
        ...all,
        { id: nextId('p', all), number: c.number, net: c.net, userName: '', side: IMPORT_SIDE, order: firstFree + i },
      ],
      kept,
    );
  return closeUp(added);
};

const COLUMN_GAP = 100;
const ROW_GAP = 40;
const FIRST_SLOT = 100;

const newBlocks = (blocks: Block[], connectors: Connector[]): Block[] => {
  const x = snap(Math.max(FIRST_SLOT - COLUMN_GAP, ...blocks.map(b => b.x + blockSize(b).w)) + COLUMN_GAP);
  return connectors.reduce<{ all: Block[]; y: number }>(
    ({ all, y }, c) => {
      const block: Block = {
        id: nextId('b', all),
        name: c.reference,
        label: '',
        kicadLinked: true,
        x,
        y,
        pins: c.pins.map((p, i) => ({
          id: `p${i + 1}`,
          number: p.number,
          net: p.net,
          userName: '',
          side: IMPORT_SIDE,
          order: i,
        })),
      };
      return { all: [...all, block], y: snap(y + blockSize(block).h + ROW_GAP) };
    },
    { all: blocks, y: FIRST_SLOT },
  ).all.slice(blocks.length);
};

const reportOf = (project: Project, connectors: Connector[]): ImportReport => ({
  orphanedWires: project.wires.flatMap(w =>
    [w.from, ...(w.to ? [w.to] : [])].flatMap(end => {
      const block = project.blocks.find(b => b.id === end.blockId)!;
      const pin = block.pins.find(p => p.id === end.pinId)!;
      return pin.leftover ? [{ wireId: w.id, block: block.name, pin: pin.number }] : [];
    }),
  ),
  missingBlocks: project.blocks
    .filter(b => b.kicadLinked && !connectors.some(c => c.reference === b.name))
    .map(b => b.name),
});

export const mergeImport = (
  project: Project,
  connectors: Connector[],
  ticked: string[],
): { project: Project; report: ImportReport } => {
  const importable = connectors.filter(c => ticked.includes(c.reference) && !isClash(project, c.reference));
  const blocks = project.blocks.map(b => {
    const connector = b.kicadLinked ? importable.find(c => c.reference === b.name) : undefined;
    return connector ? { ...b, pins: mergedPins(b, connector, project.wires) } : b;
  });
  const created = newBlocks(blocks, importable.filter(c => !linkedBlock(project, c.reference)));
  const merged = { ...project, blocks: [...blocks, ...created] };
  const next = { ...merged, wires: followPins(project, merged) };
  return { project: next, report: reportOf(next, connectors) };
};
