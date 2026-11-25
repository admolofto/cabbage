import { useMemo } from 'react';
import {
  buildCutList,
  cutListCsv,
  describeBanding,
  describeSheet,
  formatArea,
  formatRun,
  partName,
  type CutGroup,
} from '../core/cut-list';
import type { CabbageDocument } from '../core/document';
import type { Editor } from '../core/editor';
import { formatLength, type UnitSettings } from '../core/units';
import { CloseIcon } from './icons';
import { CommitField } from './Inspector';
import { downloadText } from './project-file';

function plural(count: number, one: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${one}s`;
}

/** The line under a group's heading: how much there is to cut and to buy. */
function groupSummary(group: CutGroup, units: UnitSettings): string {
  const facts = [plural(group.pieces, 'part'), formatArea(group.area, units)];
  if (group.sheetsAtLeast > 0) {
    facts.push(`at least ${plural(group.sheetsAtLeast, 'sheet')} of ${describeSheet(units)}`);
  }
  if (group.banding > 0) facts.push(`${formatRun(group.banding, units)} of edge banding`);
  return facts.join(' · ');
}

interface CutListPanelProps {
  editor: Editor;
  document: CabbageDocument;
  selection: ReadonlySet<string>;
  units: UnitSettings;
  onClose: () => void;
}

/**
 * The cut list, docked under the 3D view. It is worked out from the boards as
 * they stand, so it is always current. Clicking a line selects its boards in
 * the view, or the cabinets they belong to, and typing in the Part column
 * renames boards that stand alone, all at once.
 */
export function CutListPanel({ editor, document, selection, units, onClose }: CutListPanelProps) {
  const groups = useMemo(() => buildCutList(document), [document]);
  const pieces = groups.reduce((total, group) => total + group.pieces, 0);
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  const selectParts = (ids: readonly string[]) => {
    editor.setTool('select');
    editor.setSelection(ids);
  };

  return (
    <section className="cutlist" aria-label="Cut list">
      <header className="cutlist-header">
        <h2>Cut list</h2>
        <span className="cutlist-project">
          {document.name} · {today}
        </span>
        <span className="cutlist-summary">
          {pieces === 0 ? 'No parts yet' : `${plural(pieces, 'part')} in ${plural(groups.length, 'group')}`}
        </span>
        <div className="cutlist-actions">
          <button
            type="button"
            className="quiet-button"
            disabled={pieces === 0}
            onClick={() => downloadText(`${document.name} cut list.csv`, cutListCsv(groups, units), 'text/csv')}
          >
            Export CSV
          </button>
          <button type="button" className="quiet-button" disabled={pieces === 0} onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="icon-button" aria-label="Close cut list" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="cutlist-body">
        {pieces === 0 && <p className="cutlist-empty">Draw a board and it shows up here.</p>}
        {groups.map((group) => (
          <table key={group.key} className="cutlist-table">
            <caption>
              <strong>
                {group.material.name}, {formatLength(group.thickness, units)}
              </strong>
              <span>{groupSummary(group, units)}</span>
            </caption>
            {/* Fixed column widths, so the columns line up from one group to the next. */}
            <colgroup>
              <col className="col-quantity" />
              <col className="col-part" />
              <col className="col-size" />
              <col className="col-size" />
              <col className="col-grain" />
              <col className="col-banding" />
            </colgroup>
            <thead>
              <tr>
                <th className="number">Qty</th>
                <th>Part</th>
                <th className="number">Length</th>
                <th className="number">Width</th>
                <th>Grain</th>
                <th>Edge banding</th>
              </tr>
            </thead>
            <tbody>
              {group.parts.map((part) => (
                <tr
                  key={part.key}
                  data-selected={part.ownerIds.every((id) => selection.has(id)) || undefined}
                  onClick={() => selectParts(part.ownerIds)}
                >
                  <td className="number">{part.quantity}</td>
                  <td className="part-name">
                    <div className="part-cell">
                      {part.renamable ? (
                        <>
                          <CommitField
                            label={`Name of ${partName(part)}`}
                            value={partName(part)}
                            onCommit={(value) => editor.renameBoards(part.boardIds, value)}
                          />
                          <span className="print-name">{partName(part)}</span>
                        </>
                      ) : (
                        // A cabinet names its own boards, so these are not typed over.
                        <span className="part-fixed">{partName(part)}</span>
                      )}
                      {part.oversize && <span className="warning-chip">Bigger than a full sheet</span>}
                    </div>
                  </td>
                  <td className="number">{formatLength(part.length, units)}</td>
                  <td className="number">{formatLength(part.width, units)}</td>
                  <td>{group.material.grain ? 'Along length' : 'None'}</td>
                  <td>{describeBanding(part)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}
