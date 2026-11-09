import { useState } from 'preact/hooks';
import { BLOCK_SCALE, makePins, nameTaken, pinFloor, resizedPins, SIDES, wiredPinIds } from '../project/project.ts';
import type { Block, Pin, Project, Side } from '../project/types.ts';

type Props = {
  project: Project;
  block: Block | null;
  defaultName: string;
  onSubmit: (name: string, label: string, pins: Pin[], scale: number) => void;
  onCancel: () => void;
};

const countOn = (pins: Pin[], side: Side) => pins.filter(p => p.side === side).length;

export const BlockForm = ({ project, block, defaultName, onSubmit, onCancel }: Props) => {
  const [name, setName] = useState(block?.name ?? defaultName);
  const [label, setLabel] = useState(block?.label ?? '');
  const [pins, setPins] = useState<Pin[]>(block ? [...block.pins] : makePins({ left: 0, right: 4, top: 0, bottom: 0 }));
  const [scale, setScale] = useState(String(block?.scale ?? 1));

  const taken = nameTaken(project, name, block?.id);
  const wired = block ? wiredPinIds(project, block.id) : [];
  const setCount = (side: Side, value: number) => {
    const counts = {
      left: countOn(pins, 'left'),
      right: countOn(pins, 'right'),
      top: countOn(pins, 'top'),
      bottom: countOn(pins, 'bottom'),
      [side]: Math.max(0, value),
    };
    setPins(block ? resizedPins(pins, counts, wired) : makePins(counts));
  };
  const changePin = (id: string, change: Partial<Pin>) =>
    setPins(pins.map(p => (p.id === id ? { ...p, ...change } : p)));

  return (
    <div class="modal">
      <form
        onSubmit={e => {
          e.preventDefault();
          if (!taken && name.trim()) onSubmit(name.trim(), label, pins, Number(scale));
        }}
      >
        <label>
          Name
          <input value={name} disabled={block?.kicadLinked} autoFocus onInput={e => setName(e.currentTarget.value)} />
        </label>
        {taken && <div class="error">Another Block already has this name.</div>}
        <label>
          Label
          <input value={label} onInput={e => setLabel(e.currentTarget.value)} />
        </label>
        <label>
          Scale
          <input type="number" required {...BLOCK_SCALE} value={scale} onInput={e => setScale(e.currentTarget.value)} />
        </label>
        {!block?.kicadLinked && (
          <div class="counts">
            {SIDES.map(side => (
              <label key={side}>
                {side}
                <input
                  type="number"
                  min={pinFloor(pins, side, wired)}
                  value={countOn(pins, side)}
                  onInput={e => setCount(side, Number(e.currentTarget.value))}
                />
              </label>
            ))}
          </div>
        )}
        <div class="pin-list">
          {pins.map(p => (
            <div class="pin-row" key={p.id}>
              <span>{p.number}</span>
              <input
                placeholder={p.net || 'Pin name'}
                value={p.userName}
                onInput={e => changePin(p.id, { userName: e.currentTarget.value })}
              />
              <select value={p.side} onChange={e => changePin(p.id, { side: e.currentTarget.value as Side })}>
                {SIDES.map(side => (
                  <option key={side} value={side}>{side}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div class="row">
          <button type="submit">{block ? 'Save' : 'Create'}</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
};
