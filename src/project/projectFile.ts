import { parseProject, SIDES } from './project.ts';
import type { Project, Side, WireEnd } from './types.ts';

export type ProjectFile = { ok: true; project: Project } | { ok: false; reason: string };

type Fields = Record<string, unknown>;

const REQUIRED_LISTS = ['blocks', 'wires', 'harnesses', 'zones', 'notes', 'customColours'];

const NOT_A_PROJECT = 'it is not a project file';
const BROKEN = 'the project file is damaged';

const refuse = (reason: string): ProjectFile => ({ ok: false, reason });

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
// IDs must end in a number: serialize sorts by it and nextId increments it.
const isId = (value: unknown): boolean => isText(value) && /^\D*\d+$/.test(value);
const isPoint = (value: unknown): boolean => isRecord(value) && isNumber(value.x) && isNumber(value.y);
const isListOf = (value: unknown, check: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);

const isPin = (p: unknown): boolean =>
  isRecord(p) && isId(p.id) && isText(p.number) && SIDES.includes(p.side as Side) && isNumber(p.order);

const isBlock = (b: unknown): boolean =>
  isRecord(b) && isId(b.id) && isText(b.name) && isPoint(b) && isListOf(b.pins, isPin);

const isEnd = (e: unknown): boolean => isRecord(e) && isText(e.blockId) && isText(e.pinId);

const isWire = (w: unknown): boolean =>
  isRecord(w) &&
  isId(w.id) &&
  isEnd(w.from) &&
  (w.to === null || isEnd(w.to)) &&
  isListOf(w.corners, isPoint) &&
  isListOf(w.colours, isText) &&
  (w.colours as unknown[]).length > 0;

const isHarness = (h: unknown): boolean =>
  isRecord(h) && isId(h.id) && isText(h.name) && isListOf(h.wireIds, isText) && (h.wireIds as unknown[]).length > 0 && isPoint(h.arc);

const isZone = (z: unknown): boolean =>
  isRecord(z) && isId(z.id) && isText(z.name) && isPoint(z) && isNumber(z.w) && isNumber(z.h);

const isNote = (n: unknown): boolean => isRecord(n) && isId(n.id) && isText(n.text) && isPoint(n);
const isColour = (c: unknown): boolean => isRecord(c) && isText(c.name) && isText(c.hex);
const isZoneDistance = (d: unknown): boolean => isRecord(d) && isText(d.zoneA) && isText(d.zoneB) && isNumber(d.mm);

const hasShape = (data: Fields): boolean =>
  isListOf(data.blocks, isBlock) &&
  isListOf(data.wires, isWire) &&
  isListOf(data.harnesses, isHarness) &&
  isListOf(data.zones, isZone) &&
  isListOf(data.notes, isNote) &&
  isListOf(data.customColours, isColour) &&
  isListOf(data.zoneDistances ?? [], isZoneDistance);

const idsAreUnique = (items: { id: string }[]): boolean => new Set(items.map(i => i.id)).size === items.length;

const referencesResolve = ({ blocks, wires, harnesses, zones, zoneDistances, notes }: Project): boolean => {
  const pinKeys = new Set(blocks.flatMap(b => b.pins.map(p => `${b.id}:${p.id}`)));
  const wireIds = new Set(wires.map(w => w.id));
  const zoneIds = new Set(zones.map(z => z.id));
  const endExists = (end: WireEnd) => pinKeys.has(`${end.blockId}:${end.pinId}`);
  return (
    [blocks, ...blocks.map(b => b.pins), wires, harnesses, zones, notes].every(idsAreUnique) &&
    wires.every(w => endExists(w.from) && (w.to === null || endExists(w.to))) &&
    harnesses.every(h => h.wireIds.every(id => wireIds.has(id))) &&
    zoneDistances.every(d => zoneIds.has(d.zoneA) && zoneIds.has(d.zoneB))
  );
};

export const readProjectFile = (text: string): ProjectFile => {
  const data = parseJson(text);
  if (!isRecord(data) || data.version !== 1) return refuse(NOT_A_PROJECT);
  if (!REQUIRED_LISTS.every(key => Array.isArray(data[key]))) return refuse(NOT_A_PROJECT);
  if (data.zoneDistances !== undefined && !Array.isArray(data.zoneDistances)) return refuse(NOT_A_PROJECT);
  if (!hasShape(data)) return refuse(BROKEN);
  const project = parseProject(text);
  return referencesResolve(project) ? { ok: true, project } : refuse(BROKEN);
};

export const projectFileName = (name: string): string => {
  const safe = name.trim().replace(/[/\\:*?"<>|]/g, '-').replace(/\.json$/i, '');
  return `${safe || 'project'}.json`;
};
