import { CABINET_KIND_NAMES, mostShelves, type Cabinet } from '../core/cabinet';
import type { Editor } from '../core/editor';
import { allMaterials, type Material } from '../core/materials';
import { parseLength } from '../core/parse-length';
import { formatLength, type UnitSettings } from '../core/units';
import { CommitField, shared } from './Inspector';

type LengthKey = 'width' | 'height' | 'depth' | 'toeKick';

const LENGTHS: readonly { key: LengthKey; label: string }[] = [
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' },
  { key: 'depth', label: 'Depth' },
  { key: 'toeKick', label: 'Toe kick' },
];

interface CabinetPanelProps {
  editor: Editor;
  cabinets: readonly Cabinet[];
  materials: readonly Material[];
  units: UnitSettings;
}

/**
 * The sizes of the selected cabinets. Changing one rebuilds the cabinet's
 * boards. With several cabinets selected, each change goes to all of them.
 */
export function CabinetPanel({ editor, cabinets, materials, units }: CabinetPanelProps) {
  const ids = cabinets.map((cabinet) => cabinet.id);
  const key = ids.join(' ');
  const one = cabinets.length === 1 ? cabinets[0]! : null;
  const name = shared(cabinets, (cabinet) => cabinet.name);
  const materialId = shared(cabinets, (cabinet) => cabinet.materialId);
  const shelves = shared(cabinets, (cabinet) => cabinet.shelves);
  const room = cabinets.every((cabinet) => cabinet.shelves < mostShelves(cabinet));

  return (
    <aside className="inspector" aria-label="Cabinet details">
      <h2>{one ? `${CABINET_KIND_NAMES[one.kind]} cabinet` : `${cabinets.length} cabinets`}</h2>

      <label className="field">
        <span>Name</span>
        <CommitField
          key={key}
          label="Name"
          value={name ?? ''}
          placeholder={name === null ? 'Several names' : undefined}
          onCommit={(value) => editor.renameCabinets(ids, value)}
        />
      </label>

      <div className="size-fields">
        {LENGTHS.map(({ key: field, label }) => {
          const value = shared(cabinets, (cabinet) => cabinet[field]);
          return (
            <label key={field} className="field field-row">
              <span>{label}</span>
              <CommitField
                key={key}
                label={label}
                value={value === null ? '' : formatLength(value, units)}
                placeholder={value === null ? 'Several' : undefined}
                onCommit={(text) => {
                  const length = parseLength(text, units.system);
                  // A size that cannot be read or built is turned down, and the box goes back to what is there.
                  if (length !== null) editor.resizeCabinets(ids, { [field]: length });
                }}
              />
            </label>
          );
        })}

        <div className="field field-row">
          <span>Shelves</span>
          <div className="stepper" role="group" aria-label="Shelves">
            <button
              type="button"
              aria-label="One shelf fewer"
              disabled={shelves === null || shelves === 0}
              onClick={() => shelves !== null && editor.resizeCabinets(ids, { shelves: shelves - 1 })}
            >
              −
            </button>
            <output aria-live="polite">{shelves ?? 'Several'}</output>
            <button
              type="button"
              aria-label="One shelf more"
              disabled={shelves === null || !room}
              onClick={() => shelves !== null && editor.resizeCabinets(ids, { shelves: shelves + 1 })}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <label className="field">
        <span>Material</span>
        <select
          aria-label="Material"
          value={materialId ?? ''}
          onChange={(event) => editor.setCabinetMaterial(ids, event.target.value)}
        >
          {materialId === null && (
            <option value="" disabled>
              Several
            </option>
          )}
          {allMaterials(materials).map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <button type="button" className="quiet-button unlock-button" onClick={() => editor.unlockCabinets(ids)}>
          Unlock into boards
        </button>
        <span className="inspector-note">
          Unlocking leaves plain boards you can change one by one. They no longer resize together.
        </span>
      </div>
    </aside>
  );
}
