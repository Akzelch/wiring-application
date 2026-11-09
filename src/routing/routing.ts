import type { Block, Harness, Note, Pin, Point, Project, Side, Wire, WireEnd, Zone } from '../project/types.ts';

export const GRID = 10;
export const PITCH = 20;
export const STUB = 20;
export const WIRE_WIDTH = 1.8;

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

const sideCount = (b: Block, s: Side) => b.pins.filter(p => p.side === s).length;

export const blockSize = (b: Block): { w: number; h: number } => ({
  w: Math.max(100, (Math.max(sideCount(b, 'top'), sideCount(b, 'bottom')) + 1) * PITCH),
  h: Math.max(60, (Math.max(sideCount(b, 'left'), sideCount(b, 'right')) + 1) * PITCH),
});

export const blockCentre = (b: Block): Point => {
  const { w, h } = blockSize(b);
  return { x: b.x + w / 2, y: b.y + h / 2 };
};

export const pinPoint = (b: Block, p: Pin): Point => {
  const { w, h } = blockSize(b);
  const o = (p.order + 1) * PITCH;
  return {
    left: { x: b.x, y: b.y + o },
    right: { x: b.x + w, y: b.y + o },
    top: { x: b.x + o, y: b.y },
    bottom: { x: b.x + o, y: b.y + h },
  }[p.side];
};

export const noteSize = (n: Note): { w: number; h: number } => {
  const lines = n.text.split('\n');
  return {
    w: Math.max(60, Math.max(...lines.map(l => l.length)) * 7.4 + 16),
    h: lines.length * 18 + 12,
  };
};

export const noteCentre = (n: Note): Point => {
  const { w, h } = noteSize(n);
  return { x: n.x + w / 2, y: n.y + h / 2 };
};

export const inZone = (z: Zone, p: Point): boolean =>
  p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

const blockOf = (project: Project, id: string): Block => project.blocks.find(b => b.id === id)!;
const pinOf = (b: Block, id: string): Pin => b.pins.find(p => p.id === id)!;

export const endPoint = (project: Project, end: WireEnd): Point => {
  const b = blockOf(project, end.blockId);
  return pinPoint(b, pinOf(b, end.pinId));
};

const endSide = (project: Project, end: WireEnd): Side =>
  pinOf(blockOf(project, end.blockId), end.pinId).side;

export const wirePath = (project: Project, w: Wire): Point[] => [
  endPoint(project, w.from),
  ...w.corners,
  ...(w.to ? [endPoint(project, w.to)] : []),
];

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const collinear = (a: Point, b: Point, c: Point) =>
  (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);

export const clean = (pts: Point[]): Point[] => {
  const step = pts.filter((p, i) => i === 0 || i === pts.length - 1 || !same(p, pts[i - 1]));
  const out = step.filter((p, i) => i === 0 || i === step.length - 1 || !collinear(step[i - 1], p, step[i + 1]));
  return out.length === pts.length ? out : clean(out);
};

const OUTWARD: Record<Side, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

const guardStart = (pts: Point[], side: Side): Point[] => {
  const tidied = clean(pts);
  const [p0, p1] = tidied;
  const [nx, ny] = OUTWARD[side];
  if (nx ? p0.x !== p1.x : p0.y !== p1.y) return tidied;
  const stub = { x: p0.x + nx * STUB, y: p0.y + ny * STUB };
  const kink = nx ? { x: stub.x, y: p1.y } : { x: p1.x, y: stub.y };
  return clean([p0, stub, kink, ...tidied.slice(1)]);
};

const guard = (pts: Point[], fromSide: Side, toSide: Side): Point[] =>
  guardStart([...guardStart(pts, fromSide)].reverse(), toSide).reverse();

const guardedCorners = (project: Project, w: Wire, pts: Point[]): Point[] =>
  w.to
    ? guard(pts, endSide(project, w.from), endSide(project, w.to)).slice(1, -1)
    : guardStart(pts, endSide(project, w.from)).slice(1);

const dogleg = (a: Point, b: Point, moved: Point): Point[] => {
  const mx = snap((a.x + b.x) / 2);
  const my = snap((a.y + b.y) / 2);
  return a.y === b.y
    ? [{ x: mx, y: moved.y }, { x: mx, y: b.y }]
    : [{ x: moved.x, y: my }, { x: b.x, y: my }];
};

const stretch = (pts: Point[], dx: number, dy: number): Point[] => {
  const [p0, c1] = pts;
  const moved = { x: p0.x + dx, y: p0.y + dy };
  if (pts.length === 2) {
    return (p0.y === c1.y ? dy : dx) === 0 ? [moved, c1] : [moved, ...dogleg(p0, c1, moved), c1];
  }
  const next = p0.y === c1.y ? { x: c1.x, y: c1.y + dy } : { x: c1.x + dx, y: c1.y };
  return [moved, next, ...pts.slice(2)];
};

const deltaOf = (a: Point, b: Point): Point => ({ x: b.x - a.x, y: b.y - a.y });
const isZero = (d: Point) => d.x === 0 && d.y === 0;

// Returns `after`'s Wires rerouted for any Pins that moved between the two projects.
export const followPins = (before: Project, after: Project): Wire[] =>
  after.wires.map(w => {
    const path = wirePath(before, w);
    const da = deltaOf(path[0], endPoint(after, w.from));
    const dz = w.to ? deltaOf(path[path.length - 1], endPoint(after, w.to)) : { x: 0, y: 0 };
    if (isZero(da) && isZero(dz)) return w;
    if (same(da, dz)) {
      const shifted = path.map(p => ({ x: p.x + da.x, y: p.y + da.y }));
      return { ...w, corners: guardedCorners(after, w, shifted) };
    }
    const fromMoved = isZero(da) ? path : stretch(path, da.x, da.y);
    const bothMoved = isZero(dz) ? fromMoved : stretch([...fromMoved].reverse(), dz.x, dz.y).reverse();
    return { ...w, corners: guardedCorners(after, w, bothMoved) };
  });

// A segment touching a Pin keeps its Pin end fixed: the segment slides and a new stub joins it to the Pin.
export const slidCorners = (project: Project, w: Wire, index: number, delta: Point): Point[] => {
  const base = wirePath(project, w);
  const horizontal = base[index].y === base[index + 1].y;
  const padded = [
    ...(index === 0 ? [base[0]] : []),
    ...base,
    ...(w.to && index + 1 === base.length - 1 ? [base[base.length - 1]] : []),
  ];
  const first = index === 0 ? 1 : index;
  const moved = padded.map((q, k) =>
    k === first || k === first + 1
      ? horizontal ? { x: q.x, y: q.y + delta.y } : { x: q.x + delta.x, y: q.y }
      : q,
  );
  return guardedCorners(project, w, moved);
};

export const segments = (pts: Point[]): { a: Point; b: Point }[] =>
  pts.slice(1).map((b, i) => ({ a: pts[i], b }));

export const passesOverPin = (project: Project, pts: Point[]): boolean => {
  const segs = segments(pts);
  const lastSeg = segs.length - 1;
  return project.blocks.some(b =>
    b.pins.some(p => {
      const q = pinPoint(b, p);
      return segs.some((s, i) => {
        if ((i === 0 && same(q, pts[0])) || (i === lastSeg && same(q, pts[pts.length - 1]))) return false;
        const onX = q.x >= Math.min(s.a.x, s.b.x) && q.x <= Math.max(s.a.x, s.b.x);
        const onY = q.y >= Math.min(s.a.y, s.b.y) && q.y <= Math.max(s.a.y, s.b.y);
        return onX && onY;
      });
    }),
  );
};

export const onLeftoverPin = (project: Project, w: Wire): boolean =>
  [w.from, ...(w.to ? [w.to] : [])].some(end => pinOf(blockOf(project, end.blockId), end.pinId).leftover);

export const wireWarnings = (project: Project): Set<string> =>
  new Set(
    project.wires
      .filter(w => onLeftoverPin(project, w) || passesOverPin(project, clean(wirePath(project, w))))
      .map(w => w.id),
  );

export type Draw = { from: WireEnd; pts: Point[]; history: Point[][]; flip: boolean; wireId?: string };

export const resumeDraw = (project: Project, w: Wire): Draw => {
  const pts = wirePath(project, w);
  return {
    from: w.from,
    pts,
    history: pts.slice(1).map((_, i) => pts.slice(0, i + 1)),
    flip: false,
    wireId: w.id,
  };
};

export const startDraw = (project: Project, from: WireEnd): Draw => ({
  from,
  pts: [endPoint(project, from)],
  history: [],
  flip: false,
});

type Axis = 'h' | 'v';
const sideAxis = (s: Side): Axis => (s === 'left' || s === 'right' ? 'h' : 'v');
const bend = (p: Point, c: Point, axis: Axis): Point => (axis === 'h' ? { x: c.x, y: p.y } : { x: p.x, y: c.y });

const nextAxis = (project: Project, draw: Draw): Axis => {
  const n = draw.pts.length;
  const base: Axis =
    n === 1
      ? sideAxis(endSide(project, draw.from))
      : draw.pts[n - 2].y === draw.pts[n - 1].y ? 'v' : 'h';
  return draw.flip ? (base === 'h' ? 'v' : 'h') : base;
};

export const previewDraw = (project: Project, draw: Draw, cursor: Point, endPin: WireEnd | null): Point[] => {
  const last = draw.pts[draw.pts.length - 1];
  const fromSide = endSide(project, draw.from);
  if (endPin) {
    const end = endPoint(project, endPin);
    const side = endSide(project, endPin);
    return guard([...draw.pts, bend(last, end, sideAxis(side) === 'h' ? 'v' : 'h'), end], fromSide, side);
  }
  return guardStart([...draw.pts, bend(last, cursor, nextAxis(project, draw)), cursor], fromSide);
};

type LaneSegment = {
  wire: string;
  index: number;
  horizontal: boolean;
  line: number;
  start: number;
  end: number;
  turnStart: number;
  turnEnd: number;
};
type Placed = LaneSegment & { lane: number };

const shiftRoute = (pts: Point[], offsets: number[]): Point[] => {
  const segs = segments(pts).map((s, i) => {
    const horizontal = s.a.y === s.b.y;
    const o = offsets[i];
    const shift = (p: Point) => (horizontal ? { x: p.x, y: p.y + o } : { x: p.x + o, y: p.y });
    return { a: shift(s.a), b: shift(s.b), horizontal };
  });
  return pts.map((_, i) => {
    if (i === 0) return segs[0].a;
    if (i === pts.length - 1) return segs[segs.length - 1].b;
    const [p, n] = [segs[i - 1], segs[i]];
    return p.horizontal ? { x: n.a.x, y: p.a.y } : { x: p.a.x, y: n.a.y };
  });
};

const describeSegments = (routes: { w: Wire; pts: Point[] }[]): LaneSegment[] =>
  routes.flatMap(r =>
    segments(r.pts).map((s, i, all) => {
      const horizontal = s.a.y === s.b.y;
      const along = (p: Point) => (horizontal ? p.x : p.y);
      const across = (p: Point) => (horizontal ? p.y : p.x);
      const turnAt = (corner: Point, other: Point | null) => (other ? Math.sign(across(other) - across(corner)) : 0);
      const startFirst = along(s.a) <= along(s.b);
      const [lo, hi] = startFirst ? [s.a, s.b] : [s.b, s.a];
      const before = i > 0 ? all[i - 1].a : null;
      const after = i < all.length - 1 ? all[i + 1].b : null;
      return {
        wire: r.w.id,
        index: i,
        horizontal,
        line: across(s.a),
        start: along(lo),
        end: along(hi),
        turnStart: turnAt(lo, startFirst ? before : after),
        turnEnd: turnAt(hi, startFirst ? after : before),
      };
    }),
  );

const overlaps = (a: LaneSegment, b: LaneSegment) => a.start < b.end && b.start < a.end;

const compareLanes = (a: LaneSegment, b: LaneSegment): number => {
  const votes =
    (a.end < b.end ? a.turnEnd : 0) - (b.end < a.end ? b.turnEnd : 0) +
    (a.start > b.start ? a.turnStart : 0) - (b.start > a.start ? b.turnStart : 0) +
    (a.end === b.end ? a.turnEnd - b.turnEnd : 0) + (a.start === b.start ? a.turnStart - b.turnStart : 0);
  return votes || (a.turnStart + a.turnEnd) - (b.turnStart + b.turnEnd) || (a.wire < b.wire ? -1 : 1);
};

const clusterSegments = (segs: LaneSegment[]): LaneSegment[][] =>
  [...segs]
    .sort((a, b) => a.start - b.start)
    .reduce<{ items: LaneSegment[]; reach: number }[]>((clusters, s) => {
      const open = clusters[clusters.length - 1];
      return open && open.reach > s.start
        ? [...clusters.slice(0, -1), { items: [...open.items, s], reach: Math.max(open.reach, s.end) }]
        : [...clusters, { items: [s], reach: s.end }];
    }, [])
    .map(c => c.items);

const assignLanes = (items: LaneSegment[]) => {
  const placed = [...items].sort(compareLanes).reduce<Placed[]>((done, s) => {
    const lane = Math.max(-1, ...done.filter(d => overlaps(d, s)).map(d => d.lane)) + 1;
    return [...done, { ...s, lane }];
  }, []);
  const centre = Math.max(...placed.map(p => p.lane)) / 2;
  return placed.map(p => ({ ...p, slot: p.lane - centre }));
};

// Overlapping Wires are drawn side by side, exactly touching; stored routes are untouched.
export const displayPaths = (project: Project): Map<string, Point[]> => {
  const routes = project.wires.map(w => ({ w, pts: wirePath(project, w) }));
  const segs = describeSegments(routes);
  const keyOf = (s: LaneSegment) => `${s.horizontal}:${s.line}`;
  const lines = [...new Set(segs.map(keyOf))];
  const lanes = lines.flatMap(key => clusterSegments(segs.filter(s => keyOf(s) === key)).flatMap(assignLanes));
  const slotOf = new Map(lanes.map(l => [`${l.wire}:${l.index}`, l.slot]));
  return new Map(
    routes.map(r => [
      r.w.id,
      shiftRoute(r.pts, r.pts.slice(1).map((_, i) => slotOf.get(`${r.w.id}:${i}`)! * WIRE_WIDTH)),
    ]),
  );
};

const nearestOnPath = (pts: Point[], target: Point): Point =>
  segments(pts)
    .map(({ a, b }) => {
      const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - a.x) * (b.x - a.x) + (target.y - a.y) * (b.y - a.y)) / length));
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    })
    .reduce((best, p) => (distance(p, target) < distance(best, target) ? p : best));

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export const harnessMidpoint = (project: Project, wire: Wire): Point => {
  const longest = segments(wirePath(project, wire)).reduce((best, s) =>
    distance(s.a, s.b) > distance(best.a, best.b) ? s : best,
  );
  return { x: snap((longest.a.x + longest.b.x) / 2), y: snap((longest.a.y + longest.b.y) / 2) };
};

export const harnessArc = (project: Project, h: Harness): { start: Point; control: Point; end: Point; name: Point } => {
  const paths = displayPaths(project);
  const hits = h.wireIds.map(id => nearestOnPath(paths.get(id)!, h.arc));
  const pairs = hits.flatMap(a => hits.map(b => ({ a, b })));
  const { a, b } = pairs.reduce((best, p) => (distance(p.a, p.b) > distance(best.a, best.b) ? p : best));
  const start = distance(a, b) < 16 ? { x: a.x - 12, y: a.y - 12 } : a;
  const end = distance(a, b) < 16 ? { x: a.x + 12, y: a.y + 12 } : b;
  const length = Math.max(1, distance(start, end));
  const bulge = Math.min(24, length / 3);
  const control = {
    x: (start.x + end.x) / 2 + ((end.y - start.y) / length) * bulge,
    y: (start.y + end.y) / 2 - ((end.x - start.x) / length) * bulge,
  };
  const name = { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 };
  return { start, control, end, name };
};
