import { Scene } from '../canvas/Scene.tsx';
import { emptySelection } from '../project/project.ts';
import type { Project } from '../project/types.ts';
import { exportWarnings, fromToRows, layoutBounds } from './export.ts';

export const PrintView = ({ project }: { project: Project }) => {
  const bounds = layoutBounds(project);
  const warnings = exportWarnings(project);
  return (
    <div class="print">
      <svg class="print-layout" viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}>
        <Scene
          project={project}
          selection={emptySelection()}
          hover={null}
          preview={null}
          marquee={null}
          editingNote={null}
          onNoteCommit={() => undefined}
          print
        />
      </svg>
      <section class="print-tables">
        {warnings.length > 0 && (
          <>
            <h1>Warnings</h1>
            <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </>
        )}
        <h1>From/to</h1>
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Colour</th>
              <th>Size</th>
              <th>Length (mm)</th>
              <th>Harness</th>
              <th>From Zone</th>
              <th>To Zone</th>
            </tr>
          </thead>
          <tbody>
            {fromToRows(project).map((r, i) => (
              <tr key={i}>
                <td>{r.from}</td>
                <td>{r.to}</td>
                <td>{r.colour}</td>
                <td>{r.gauge}</td>
                <td>{r.lengthMm}</td>
                <td>{r.harness}</td>
                <td>{r.fromZone}</td>
                <td>{r.toZone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
