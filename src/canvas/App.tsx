import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PrintView } from '../export/PrintView.tsx';
import { checklist, mergeImport, type Connector, type ImportReport } from '../kicad/kicad.ts';
import { alignedMove, type Guide } from '../project/align.ts';
import {
  apply,
  colourHex,
  commit,
  copyItems,
  emptySelection,
  newItems,
  nextFreeName,
  PALETTE,
  parseProject,
  redo,
  serialize,
  startHistory,
  undo,
  type Clipboard,
  type Command,
  type History,
} from '../project/project.ts';
import type { Block, Point, Project, Selection, WireEnd } from '../project/types.ts';
import {
  blockCentre,
  clean,
  noteCentre,
  passesOverPin,
  previewDraw,
  resumeDraw,
  segments,
  snap,
  startDraw,
  wirePath,
  type Draw,
} from '../routing/routing.ts';
import { BlockForm } from './BlockForm.tsx';
import { ImportChecklist, ImportReportView } from './ImportDialog.tsx';
import { Scene, type Hover } from './Scene.tsx';

type View = { x: number; y: number; w: number; h: number };
type Gesture =
  | { kind: 'pan'; cx: number; cy: number; view: View; scale: number }
  | { kind: 'move'; selection: Selection; start: Point; base: Project; moved: boolean; onClick: Selection | null }
  | { kind: 'slide'; wireId: string; index: number; start: Point; base: Project; moved: boolean; onClick: Selection }
  | { kind: 'arc'; harnessId: string; start: Point; origin: Point; base: Project; moved: boolean; onClick: Selection }
  | { kind: 'resize'; zoneId: string; start: Point; base: Project }
  | { kind: 'marquee'; start: Point; current: Point };
type ItemKind = keyof Selection;
type Form = { block: Block | null } | null;

const PASTE_OFFSET = { x: 40, y: 40 };

const parsePin = (key: string): WireEnd => {
  const [blockId, pinId] = key.split(':');
  return { blockId, pinId };
};

const withItem = (s: Selection, kind: ItemKind, id: string): Selection => ({ ...s, [kind]: [...s[kind], id] });
const withoutItem = (s: Selection, kind: ItemKind, id: string): Selection => ({ ...s, [kind]: s[kind].filter(x => x !== id) });
const only = (kind: ItemKind, id: string): Selection => withItem(emptySelection(), kind, id);

const segmentTouchesRect = (a: Point, b: Point, lo: Point, hi: Point) =>
  Math.max(a.x, b.x) >= lo.x && Math.min(a.x, b.x) <= hi.x && Math.max(a.y, b.y) >= lo.y && Math.min(a.y, b.y) <= hi.y;

const selectInRect = (project: Project, a: Point, b: Point): Selection => {
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  const inside = (p: Point) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  const blocks = project.blocks.filter(x => inside(blockCentre(x))).map(x => x.id);
  const notes = project.notes.filter(x => inside(noteCentre(x))).map(x => x.id);
  const wires =
    blocks.length + notes.length > 0
      ? []
      : project.wires
          .filter(w => segments(wirePath(project, w)).some(s => segmentTouchesRect(s.a, s.b, lo, hi)))
          .map(w => w.id);
  return { ...emptySelection(), blocks, notes, wires };
};

const selectAll = (project: Project): Selection => ({
  blocks: project.blocks.map(x => x.id),
  wires: project.wires.map(x => x.id),
  notes: project.notes.map(x => x.id),
  zones: project.zones.map(x => x.id),
  harnesses: project.harnesses.map(x => x.id),
});

const isEmpty = (s: Selection) => Object.values(s).every(ids => ids.length === 0);

export const App = () => {
  const [history, setHistory] = useState<History | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [selection, setSelection] = useState<Selection>(emptySelection());
  const [view, setView] = useState<View>({ x: 0, y: 0, w: 1600, h: 1000 });
  const [draw, setDraw] = useState<Draw | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [placingNote, setPlacingNote] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [colours, setColours] = useState<string[]>(['red']);
  const [status, setStatus] = useState('');
  const [conflict, setConflict] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customHex, setCustomHex] = useState('#00aaaa');
  const [stopped, setStopped] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [importing, setImporting] = useState<Connector[] | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const boardInput = useRef<HTMLInputElement>(null);
  const saved = useRef<{ text: string; mtimeMs: number | null }>({ text: '', mtimeMs: null });
  const saving = useRef<Promise<void>>(Promise.resolve());
  const conflictRef = useRef(false);

  useEffect(() => {
    fetch('/api/project')
      .then(r => r.json())
      .then(({ text, mtimeMs }) => {
        const project = parseProject(text);
        saved.current = { text: text === '' ? serialize(project) : text, mtimeMs };
        setHistory(startHistory(project));
      })
      .catch(error => setLoadError(String(error)));
  }, []);

  const saveNow = (project: Project, keepalive = false) => {
    saving.current = saving.current.then(async () => {
      const text = serialize(project);
      if (conflictRef.current || text === saved.current.text) return;
      const response = await fetch('/api/project', {
        method: 'PUT',
        keepalive,
        body: JSON.stringify({ text, mtimeMs: saved.current.mtimeMs }),
      });
      const result = await response.json();
      if (result.ok) {
        saved.current = { text, mtimeMs: result.mtimeMs };
      } else {
        conflictRef.current = true;
        setConflict(true);
      }
    });
    return saving.current;
  };

  const present = history?.present;
  useEffect(() => {
    if (!present) return;
    const timer = setTimeout(() => saveNow(present), 1000);
    const flush = () => saveNow(present, true);
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, [present]);

  const project = draft ?? present ?? null;
  const printView = useMemo(() => (present ? <PrintView project={present} /> : null), [present]);

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  const updateHistory = (change: (h: History) => History) => setHistory(h => (h ? change(h) : h));
  const dispatch = (command: Command) => updateHistory(h => commit(h, apply(h.present, command)));
  const viewCentre = (): Point => ({ x: snap(view.x + view.w / 2), y: snap(view.y + view.h / 2) });

  const pasteFrom = (source: Clipboard) => {
    if (!present) return;
    const next = apply(present, { type: 'paste', clipboard: source, offset: PASTE_OFFSET });
    setHistory(h => (h ? commit(h, next) : h));
    setSelection(newItems(present, next));
  };

  const applyColours = (next: string[]) => {
    setColours(next);
    if (selection.wires.length > 0) {
      dispatch({ type: 'setWireColours', wireIds: selection.wires, base: next[0], second: next[1] ?? null });
    }
  };

  const finishDraw = (current: Draw, to: WireEnd | null, corners: Point[]) => {
    dispatch(
      current.wireId
        ? { type: 'setWireRoute', wireId: current.wireId, to, corners }
        : { type: 'addWire', from: current.from, to, corners, colours },
    );
    setDraw(null);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!project || !present) return;
    const data = (e.target as SVGElement).dataset ?? {};
    const world = toWorld(e);
    const cursorNow = { x: snap(world.x), y: snap(world.y) };

    if (placingNote) {
      setPlacingNote(false);
      const next = apply(present, { type: 'createNote', text: '', at: cursorNow });
      updateHistory(h => commit(h, next));
      setEditingNote(newItems(present, next).notes[0]);
      return;
    }

    if (draw) {
      const pinKey = data.pin;
      const fromKey = `${draw.from.blockId}:${draw.from.pinId}`;
      if (pinKey === fromKey || (!pinKey && e.detail >= 2)) return;
      const to = pinKey ? parsePin(pinKey) : null;
      const pts = clean(previewDraw(project, draw, cursorNow, to));
      if (passesOverPin(project, pts)) {
        setStatus('Refused: that route passes over a Pin.');
        return;
      }
      setStatus('');
      if (to) {
        finishDraw(draw, to, pts.slice(1, -1));
      } else {
        setDraw({ ...draw, history: [...draw.history, draw.pts], pts, flip: false });
      }
      return;
    }

    if (data.pin) {
      setSelection(emptySelection());
      setDraw(startDraw(project, parsePin(data.pin)));
      return;
    }

    if (data.loose) {
      setSelection(emptySelection());
      setDraw(resumeDraw(project, project.wires.find(w => w.id === data.loose)!));
      return;
    }

    if (data.resize) {
      setGesture({ kind: 'resize', zoneId: data.resize, start: world, base: present });
      return;
    }

    if (data.seg) {
      const [wireId, index] = data.seg.split(':');
      const selected = selection.wires.includes(wireId);
      const onClick = e.shiftKey
        ? selected ? withoutItem(selection, 'wires', wireId) : withItem(selection, 'wires', wireId)
        : only('wires', wireId);
      setGesture({ kind: 'slide', wireId, index: Number(index), start: world, base: present, moved: false, onClick });
      return;
    }

    if (data.item) {
      const [kind, id] = data.item.split(':') as [ItemKind, string];
      const selected = selection[kind].includes(id);
      if (kind === 'harnesses') {
        const arc = present.harnesses.find(h => h.id === id)!.arc;
        const onClick = e.shiftKey
          ? selected ? withoutItem(selection, kind, id) : withItem(selection, kind, id)
          : only(kind, id);
        setGesture({ kind: 'arc', harnessId: id, start: world, origin: arc, base: present, moved: false, onClick });
        return;
      }
      const dragged = selected ? selection : only(kind, id);
      setSelection(dragged);
      const onClick = selected
        ? (e.shiftKey ? withoutItem(selection, kind, id) : only(kind, id))
        : e.shiftKey ? withItem(selection, kind, id) : null;
      setGesture({ kind: 'move', selection: dragged, start: world, base: present, moved: false, onClick });
      return;
    }

    if (e.shiftKey) {
      setGesture({ kind: 'marquee', start: world, current: world });
      return;
    }
    setSelection(emptySelection());
    setGesture({ kind: 'pan', cx: e.clientX, cy: e.clientY, view, scale: svgRef.current!.getScreenCTM()!.a });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!svgRef.current) return;
    const world = toWorld(e);
    const snapped = { x: snap(world.x), y: snap(world.y) };
    if (snapped.x !== cursor.x || snapped.y !== cursor.y) setCursor(snapped);

    if (!gesture) {
      const data = (e.target as SVGElement).dataset ?? {};
      const blockId = data.item?.startsWith('blocks:') ? data.item.split(':')[1] : undefined;
      const wire = data.seg?.split(':')[0];
      const key = `${data.pin}|${wire}|${blockId}`;
      const current = `${hover?.pin}|${hover?.wire}|${hover?.block}`;
      if (key !== current) setHover(data.pin ? { pin: data.pin } : wire ? { wire } : blockId ? { block: blockId } : null);
      return;
    }

    if (gesture.kind === 'pan') {
      setView({
        ...gesture.view,
        x: gesture.view.x - (e.clientX - gesture.cx) / gesture.scale,
        y: gesture.view.y - (e.clientY - gesture.cy) / gesture.scale,
      });
      return;
    }
    if (gesture.kind === 'marquee') {
      setGesture({ ...gesture, current: world });
      return;
    }

    const delta = { x: snap(world.x - gesture.start.x), y: snap(world.y - gesture.start.y) };
    const moved = delta.x !== 0 || delta.y !== 0;

    if (gesture.kind === 'move') {
      setGesture({ ...gesture, moved: gesture.moved || moved });
      const zoneOnly = !e.shiftKey;
      const aligned = e.shiftKey ? alignedMove(gesture.base, gesture.selection, delta, zoneOnly) : { delta, guides: [] };
      setGuides(aligned.guides);
      setDraft(apply(gesture.base, { type: 'moveItems', selection: gesture.selection, delta: aligned.delta, zoneOnly }));
    } else if (gesture.kind === 'slide') {
      setGesture({ ...gesture, moved: gesture.moved || moved });
      const next = apply(gesture.base, { type: 'slideSegment', wireId: gesture.wireId, index: gesture.index, delta });
      if (next === gesture.base && moved) setStatus('Stopped: a Wire cannot pass over a Pin.');
      else {
        setStatus('');
        setDraft(next);
      }
    } else if (gesture.kind === 'arc') {
      setGesture({ ...gesture, moved: gesture.moved || moved });
      setDraft(apply(gesture.base, {
        type: 'moveHarness',
        harnessId: gesture.harnessId,
        arc: { x: gesture.origin.x + delta.x, y: gesture.origin.y + delta.y },
      }));
    } else if (gesture.kind === 'resize') {
      const zone = gesture.base.zones.find(z => z.id === gesture.zoneId)!;
      setDraft(apply(gesture.base, {
        type: 'updateZone',
        zoneId: gesture.zoneId,
        changes: { w: Math.max(100, zone.w + delta.x), h: Math.max(60, zone.h + delta.y) },
      }));
    }
  };

  const onPointerUp = () => {
    if (!gesture) return;
    setGesture(null);
    setGuides([]);
    if (gesture.kind === 'pan' || !project) return;
    if (gesture.kind === 'marquee') {
      setSelection(selectInRect(project, gesture.start, gesture.current));
      return;
    }
    const clicked = 'moved' in gesture && !gesture.moved;
    if (clicked) {
      if (gesture.onClick) setSelection(gesture.onClick);
    } else if (draft) {
      const next = draft;
      updateHistory(h => commit(h, next));
    }
    setDraft(null);
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (!project) return;
    if (draw) {
      if (draw.pts.length < 2) setDraw(null);
      else finishDraw(draw, null, draw.pts.slice(1));
      return;
    }
    const item = (e.target as SVGElement).dataset?.item;
    if (!item) return;
    const [kind, id] = item.split(':') as [ItemKind, string];
    if (kind === 'blocks') setForm({ block: project.blocks.find(b => b.id === id)! });
    if (kind === 'notes') setEditingNote(id);
    if (kind === 'harnesses') {
      const name = window.prompt('Harness name', project.harnesses.find(h => h.id === id)!.name);
      if (name) dispatch({ type: 'renameHarness', harnessId: id, name });
    }
    if (kind === 'zones') {
      const name = window.prompt('Zone name', project.zones.find(z => z.id === id)!.name);
      if (name) dispatch({ type: 'updateZone', zoneId: id, changes: { name } });
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = toWorld(e);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView(v => ({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k }));
  };

  const addHarness = () => {
    if (selection.wires.length === 0) {
      setStatus('Select Wires first.');
      return;
    }
    const name = window.prompt('Harness name');
    if (name) dispatch({ type: 'createHarness', name, wireIds: selection.wires });
  };

  const addZone = () => {
    const name = window.prompt('Zone name');
    if (!name) return;
    if (selection.blocks.length + selection.notes.length > 0) {
      dispatch({ type: 'createZoneAround', name, selection });
      return;
    }
    const c = viewCentre();
    dispatch({ type: 'createZone', name, x: c.x - 200, y: c.y - 150, w: 400, h: 300 });
  };

  const quit = async () => {
    if (!present) return;
    await saveNow(present);
    await fetch('/api/server', { method: 'DELETE' });
    setStopped(true);
  };

  const readBoard = async (file: File) => {
    const response = await fetch('/api/kicad/connectors', { method: 'POST', body: await file.text() });
    if (response.ok) setImporting(await response.json());
    else setStatus(`Could not read ${file.name}.`);
  };

  const finishImport = (connectors: Connector[], ticked: string[]) => {
    if (!present) return;
    const { project: next, report } = mergeImport(present, connectors, ticked);
    updateHistory(h => commit(h, next));
    setImporting(null);
    setImportReport(report);
  };

  const deleteSelected = () => {
    if (isEmpty(selection)) return;
    dispatch({ type: 'deleteItems', selection });
    setSelection(emptySelection());
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!project || !present) return;
    const tag = (e.target as HTMLElement).tagName;
    if (form || importing || importReport || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
      const actions: Record<string, () => void> = {
        z: () => updateHistory(undo),
        y: () => updateHistory(redo),
        a: () => setSelection(selectAll(project)),
        s: () => void saveNow(present),
        c: () => setClipboard(copyItems(project, selection)),
        v: () => clipboard && pasteFrom(clipboard),
        d: () => pasteFrom(copyItems(project, selection)),
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
      return;
    }

    if (e.key === 'Escape') {
      setDraw(null);
      setPlacingNote(false);
      setStatus('');
    } else if (e.key === ' ' && draw) {
      e.preventDefault();
      setDraw({ ...draw, flip: !draw.flip });
    } else if (e.key === 'Backspace' && draw) {
      e.preventDefault();
      setDraw(
        draw.history.length === 0
          ? null
          : { ...draw, pts: draw.history[draw.history.length - 1], history: draw.history.slice(0, -1), flip: false },
      );
    } else if (e.key === 'Delete') {
      deleteSelected();
    } else if (key === 'w') {
      if (hover?.pin && !draw) setDraw(startDraw(project, parsePin(hover.pin)));
      else if (!draw) setStatus('Hover a Pin, then press W.');
    } else if (key === 'n') {
      setPlacingNote(true);
      setStatus('Click to place the Note.');
    } else if (key === 'r' && selection.blocks.length > 0) {
      dispatch({ type: 'rotateBlocks', blockIds: selection.blocks });
    } else if (key === 'h') {
      addHarness();
    } else if (/^[1-9]$/.test(e.key)) {
      applyColours([PALETTE[Number(e.key) - 1].name, ...colours.slice(1)]);
    }
  };

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  if (stopped) {
    return <p>{conflict ? 'The app has stopped. Your latest edits were not saved, because the file changed on disk.' : 'The app has stopped and your work is saved. You can close this tab.'}</p>;
  }
  if (loadError) return <p class="error">Could not load the project file: {loadError}</p>;
  if (!project) return <p>Loading</p>;

  const endPin = draw && hover?.pin && hover.pin !== `${draw.from.blockId}:${draw.from.pinId}` ? parsePin(hover.pin) : null;
  const preview = draw
    ? { pts: previewDraw(project, draw, cursor, endPin), colour: colourHex(project, colours[0]) }
    : null;
  const allColours = [...PALETTE, ...project.customColours];

  const commitNote = (id: string, text: string) => {
    setEditingNote(null);
    if (text.trim() === '') dispatch({ type: 'deleteItems', selection: only('notes', id) });
    else dispatch({ type: 'updateNote', noteId: id, text });
  };

  return (
    <div class="layout">
      <div class="stage">
        <svg ref={svgRef} class="canvas" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onPointerDown={onPointerDown} onDblClick={onDoubleClick}>
          <Scene
            project={project}
            selection={selection}
            hover={hover}
            preview={preview}
            marquee={gesture?.kind === 'marquee' ? { a: gesture.start, b: gesture.current } : null}
            editingNote={editingNote}
            onNoteCommit={commitNote}
            guides={guides}
          />
        </svg>
        <div class="status">{status}</div>
        {conflict && (
          <div class="banner">
            File changed on disk, reload. Autosave has stopped.
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        )}
      </div>
      <aside>
        <h2>Add</h2>
        <div class="row">
          <button onClick={() => setForm({ block: null })}>Block</button>
          <button onClick={addZone}>Zone</button>
          <button onClick={() => boardInput.current?.click()}>Import KiCad</button>
          <input
            ref={boardInput}
            type="file"
            accept=".kicad_pcb"
            hidden
            onChange={e => {
              const input = e.currentTarget;
              if (input.files?.[0]) void readBoard(input.files[0]);
              input.value = '';
            }}
          />
        </div>
        <h2>Export</h2>
        <div class="row">
          <button onClick={() => window.print()}>Print to PDF</button>
        </div>
        <h2>App</h2>
        <div class="row">
          <button onClick={() => void quit()}>Quit</button>
        </div>
        <h2>Colour</h2>
        <div class="row">
          {allColours.map(c => (
            <button key={c.name} class={`swatch ${colours[0] === c.name ? 'on' : ''}`} title={c.name} style={{ background: c.hex }} onClick={() => applyColours([c.name, ...colours.slice(1)])} />
          ))}
        </div>
        <h2>Second colour</h2>
        <select value={colours[1] ?? ''} onChange={e => applyColours(e.currentTarget.value ? [colours[0], e.currentTarget.value] : [colours[0]])}>
          <option value="">None</option>
          {allColours.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <h2>Custom colour</h2>
        <div class="row">
          <input placeholder="Name" size={10} value={customName} onInput={e => setCustomName(e.currentTarget.value)} />
          <input type="color" value={customHex} onInput={e => setCustomHex(e.currentTarget.value)} />
          <button
            onClick={() => {
              if (!customName.trim()) return;
              dispatch({ type: 'addCustomColour', colour: { name: customName.trim(), hex: customHex } });
              setCustomName('');
            }}
          >
            Add
          </button>
        </div>
        <h2>Keys</h2>
        <dl class="keys">
          <dt>Click Pin</dt><dd>Start a Wire</dd>
          <dt>W</dt><dd>Wire from hovered Pin</dd>
          <dt>Space</dt><dd>Flip bend</dd>
          <dt>Backspace</dt><dd>Remove last corner</dd>
          <dt>Double-click</dt><dd>End Wire unfinished</dd>
          <dt>Click red square</dt><dd>Continue that Wire</dd>
          <dt>N</dt><dd>Place a Note</dd>
          <dt>R</dt><dd>Rotate</dd>
          <dt>H</dt><dd>Harness from Wires</dd>
          <dt>1-9</dt><dd>Wire colour</dd>
          <dt>Shift+drag</dt><dd>Box select</dd>
          <dt>Shift+drag item</dt><dd>Align with other items</dd>
          <dt>Shift+drag Zone</dt><dd>Also moves its contents</dd>
          <dt>Shift+click</dt><dd>Add to selection</dd>
          <dt>Double-click</dt><dd>Edit item</dd>
          <dt>Drag empty</dt><dd>Pan; scroll zooms</dd>
          <dt>Ctrl+C V D</dt><dd>Copy, paste, duplicate</dd>
          <dt>Ctrl+Z Y</dt><dd>Undo, redo</dd>
          <dt>Ctrl+A S</dt><dd>Select all, save</dd>
          <dt>Del, Esc</dt><dd>Delete, cancel</dd>
        </dl>
      </aside>
      {form && (
        <BlockForm
          project={project}
          block={form.block}
          defaultName={nextFreeName(project.blocks.map(b => b.name), 'J0')}
          onCancel={() => setForm(null)}
          onSubmit={(name, label, pins) => {
            dispatch(
              form.block
                ? { type: 'updateBlock', blockId: form.block.id, name, label, pins }
                : { type: 'createBlock', name, label, at: viewCentre(), pins },
            );
            setForm(null);
          }}
        />
      )}
      {importing && (
        <ImportChecklist
          entries={checklist(project, importing)}
          onCancel={() => setImporting(null)}
          onImport={ticked => finishImport(importing, ticked)}
        />
      )}
      {importReport && <ImportReportView report={importReport} onClose={() => setImportReport(null)} />}
      {printView}
    </div>
  );
};
