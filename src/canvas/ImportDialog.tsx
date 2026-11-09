import { useState } from 'preact/hooks';
import type { ChecklistEntry, ImportReport } from '../kicad/kicad.ts';

type ChecklistProps = {
  entries: ChecklistEntry[];
  onImport: (ticked: string[]) => void;
  onCancel: () => void;
};

export const ImportChecklist = ({ entries, onImport, onCancel }: ChecklistProps) => {
  const [ticked, setTicked] = useState(entries.filter(e => e.ticked).map(e => e.reference));
  const toggle = (reference: string, on: boolean) =>
    setTicked(on ? [...ticked, reference] : ticked.filter(r => r !== reference));

  return (
    <div class="modal">
      <form
        onSubmit={e => {
          e.preventDefault();
          onImport(ticked);
        }}
      >
        <strong>Import from KiCad</strong>
        {entries.length === 0 && <div>No footprints with Pins were found on this board.</div>}
        <div>
          {entries.map(entry => (
            <label class="check" key={entry.reference}>
              <input
                type="checkbox"
                disabled={entry.clash}
                checked={ticked.includes(entry.reference)}
                onChange={e => toggle(entry.reference, e.currentTarget.checked)}
              />
              <span>{entry.reference}</span>
              <span class="muted">{entry.pinCount} Pins</span>
              {entry.clash && <span class="error">Name clash with a custom Block; rename it to import this</span>}
            </label>
          ))}
        </div>
        <div class="row">
          <button type="submit">Import</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
};

export const ImportReportView = ({ report, onClose }: { report: ImportReport; onClose: () => void }) => {
  const { orphanedWires, missingBlocks } = report;
  const clean = orphanedWires.length + missingBlocks.length === 0;
  return (
    <div class="modal">
      <form
        onSubmit={e => {
          e.preventDefault();
          onClose();
        }}
      >
        <strong>Import report</strong>
        {clean && <div>Everything matched the board.</div>}
        {orphanedWires.length > 0 && (
          <div>
            <h2>Wires on Pins no longer on the board</h2>
            <ul>
              {orphanedWires.map(o => (
                <li key={`${o.wireId}:${o.block}:${o.pin}`}>{o.block} Pin {o.pin} ({o.wireId})</li>
              ))}
            </ul>
          </div>
        )}
        {missingBlocks.length > 0 && (
          <div>
            <h2>Blocks no longer on the board</h2>
            <ul>{missingBlocks.map(name => <li key={name}>{name}</li>)}</ul>
          </div>
        )}
        <div class="row">
          <button type="submit" autoFocus>Close</button>
        </div>
      </form>
    </div>
  );
};
