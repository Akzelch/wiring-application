import { useEffect, useRef } from 'preact/hooks';
import type { Guide } from '../project/align.ts';
import { wireWidth } from '../project/gauge.ts';
import { colourHex, pinLabel } from '../project/project.ts';
import type { Point, Project, Selection } from '../project/types.ts';
import {
  blockSize,
  displayPaths,
  harnessArc,
  harnessMidpoint,
  noteSize,
  pinPoint,
  segments,
  wireWarnings,
} from '../routing/routing.ts';

export type Hover = { pin?: string; wire?: string; block?: string } | null;
export type Marquee = { a: Point; b: Point } | null;

type Props = {
  project: Project;
  selection: Selection;
  hover: Hover;
  preview: { pts: Point[]; colour: string; width: number } | null;
  marquee: Marquee;
  editingNote: string | null;
  onNoteCommit: (id: string, text: string) => void;
  print?: boolean;
  guides?: Guide[];
};

const points = (pts: Point[]) => pts.map(p => `${p.x},${p.y}`).join(' ');

const NoteEditor = ({ text, onCommit }: { text: string; onCommit: (text: string) => void }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <textarea
      ref={ref}
      class="note-edit"
      defaultValue={text}
      onBlur={e => onCommit(e.currentTarget.value)}
      onKeyDown={e => {
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
    />
  );
};

const LIT_EXTRA = 1.7;
const PRINT_WARNING_EXTRA = 2.7;
const WARNING_HALO_EXTRA = 7.2;
const MIN_PREVIEW_WIDTH = 2.5;

export const Scene = ({ project, selection, hover, preview, marquee, editingNote, onNoteCommit, print = false, guides = [] }: Props) => {
  const display = displayPaths(project);
  const warnings = wireWarnings(project);
  const hoveredBlock = hover?.block;
  const wireCount = (blockId: string, pinId: string) =>
    project.wires.filter(
      w => (w.from.blockId === blockId && w.from.pinId === pinId) || (w.to?.blockId === blockId && w.to.pinId === pinId),
    ).length;

  return (
    <>
      {project.zones.map(z => {
        const selected = selection.zones.includes(z.id);
        return (
          <g key={z.id}>
            <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="#1f5fbf0f" stroke={selected ? 'var(--accent)' : '#9a9a92'} stroke-width={selected ? 2 : 1} pointer-events="none" />
            <rect data-item={`zones:${z.id}`} x={z.x} y={z.y} width={z.w} height={22} fill="#1f5fbf1c" style="cursor:move" />
            <text class="zone-name" x={z.x + 6} y={z.y + 16}>{z.name}</text>
            {!print && <rect data-resize={z.id} x={z.x + z.w - 10} y={z.y + z.h - 10} width={10} height={10} fill="#9a9a92" style="cursor:nwse-resize" />}
          </g>
        );
      })}

      {project.wires.map(w => {
        const path = display.get(w.id)!;
        const lit = selection.wires.includes(w.id) || hover?.wire === w.id || (hoveredBlock && (w.from.blockId === hoveredBlock || w.to?.blockId === hoveredBlock));
        const opacity = hoveredBlock && !lit ? 0.25 : 1;
        const warned = warnings.has(w.id);
        const gaugeWidth = wireWidth(w.gauge);
        const width = gaugeWidth + (print && warned ? PRINT_WARNING_EXTRA : lit ? LIT_EXTRA : 0);
        const marker = print && warned ? harnessMidpoint(project, w) : null;
        return (
          <g key={w.id}>
            {warned && !print && <polyline points={points(path)} fill="none" stroke="var(--warn)" stroke-width={gaugeWidth + WARNING_HALO_EXTRA} stroke-dasharray="10 6" opacity={0.55} pointer-events="none" />}
            <polyline points={points(path)} fill="none" stroke={colourHex(project, w.colours[0])} stroke-width={width} opacity={opacity} pointer-events="none" />
            {w.colours[1] && <polyline points={points(path)} fill="none" stroke={colourHex(project, w.colours[1])} stroke-width={width} stroke-dasharray="8 8" opacity={opacity} pointer-events="none" />}
            {marker && <text class="warning-mark" x={marker.x + 6} y={marker.y - 6}>!</text>}
            {!print && segments(path).map((s, i) => (
              <line key={i} data-seg={`${w.id}:${i}`} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} stroke="transparent" stroke-width={10} style={{ cursor: s.a.y === s.b.y ? 'ns-resize' : 'ew-resize' }} />
            ))}
          </g>
        );
      })}

      {project.blocks.map(b => {
        const { w, h } = blockSize(b);
        const selected = selection.blocks.includes(b.id);
        return (
          <g key={b.id}>
            <rect data-item={`blocks:${b.id}`} x={b.x} y={b.y} width={w} height={h} rx={3} fill="#fff" stroke={selected ? 'var(--accent)' : '#555'} stroke-width={selected ? 2.5 : 1.2} style="cursor:move" />
            <text class="block-name" x={b.x + w / 2} y={b.y + h / 2 + 4} text-anchor="middle">{b.name}</text>
            {b.label && <text class="block-label" x={b.x} y={b.y - 6}>{b.label}</text>}
            {b.pins.map(p => {
              const q = pinPoint(b, p);
              const left = p.side === 'left';
              const right = p.side === 'right';
              return (
                <text key={p.id} class="pin-name" x={q.x + (left ? 7 : right ? -7 : 0)} y={q.y + (p.side === 'top' ? 14 : p.side === 'bottom' ? -7 : 3)} text-anchor={left ? 'start' : right ? 'end' : 'middle'}>
                  {pinLabel(p)}
                </text>
              );
            })}
          </g>
        );
      })}

      {project.notes.map(n => {
        const selected = selection.notes.includes(n.id);
        const size = noteSize(n);
        if (editingNote === n.id) {
          return (
            <foreignObject key={n.id} x={n.x} y={n.y} width={Math.max(240, size.w + 40)} height={Math.max(100, size.h + 40)}>
              <NoteEditor text={n.text} onCommit={text => onNoteCommit(n.id, text)} />
            </foreignObject>
          );
        }
        return (
          <g key={n.id}>
            <rect data-item={`notes:${n.id}`} x={n.x} y={n.y} width={size.w} height={size.h} fill="#fff8c9" stroke={selected ? 'var(--accent)' : '#c9bd6b'} stroke-width={selected ? 2 : 1} style="cursor:move" />
            <text class="note-text">
              {n.text.split('\n').map((line, i) => (
                <tspan key={i} x={n.x + 8} y={n.y + 20 + i * 18}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}

      {project.blocks.flatMap(b =>
        b.pins.map(p => {
          const q = pinPoint(b, p);
          const key = `${b.id}:${p.id}`;
          const on = hover?.pin === key;
          return (
            <circle key={key} data-pin={key} cx={q.x} cy={q.y} r={on ? 7 : 4.5} fill={on ? 'var(--accent)' : p.leftover ? 'var(--warn)' : wireCount(b.id, p.id) > 1 ? '#222' : '#fff'} stroke="#333" style="cursor:crosshair" />
          );
        }),
      )}

      {project.wires.filter(w => !w.to).map(w => {
        const end = display.get(w.id)!.at(-1)!;
        return (
          <rect key={w.id} data-loose={w.id} x={end.x - 6} y={end.y - 6} width={12} height={12} fill="#fff" stroke="var(--warn)" stroke-width={2} style="cursor:crosshair" />
        );
      })}

      {project.harnesses.map(h => {
        const { start, control, end, name } = harnessArc(project, h);
        const selected = selection.harnesses.includes(h.id);
        const d = `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`;
        return (
          <g key={h.id}>
            <path d={d} fill="none" stroke={selected ? 'var(--accent)' : '#333'} stroke-width={2} pointer-events="none" />
            <path data-item={`harnesses:${h.id}`} d={d} fill="none" stroke="transparent" stroke-width={12} style="cursor:move" />
            <text class="harness-name" x={name.x + 10} y={name.y - 8}>{h.name}</text>
          </g>
        );
      })}

      {guides.map(g => (
        <line
          key={`${g.axis}:${g.at}`}
          x1={g.axis === 'x' ? g.at : g.from}
          y1={g.axis === 'x' ? g.from : g.at}
          x2={g.axis === 'x' ? g.at : g.to}
          y2={g.axis === 'x' ? g.to : g.at}
          stroke="var(--accent)"
          stroke-width={1.5}
          stroke-dasharray="6 4"
          pointer-events="none"
        />
      ))}
      {preview && <polyline points={points(preview.pts)} fill="none" stroke={preview.colour} stroke-width={Math.max(MIN_PREVIEW_WIDTH, preview.width)} stroke-dasharray="6 4" pointer-events="none" />}
      {marquee && (
        <rect x={Math.min(marquee.a.x, marquee.b.x)} y={Math.min(marquee.a.y, marquee.b.y)} width={Math.abs(marquee.a.x - marquee.b.x)} height={Math.abs(marquee.a.y - marquee.b.y)} fill="#1f5fbf18" stroke="var(--accent)" stroke-dasharray="4 3" pointer-events="none" />
      )}
    </>
  );
};
