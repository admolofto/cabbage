import { useState } from 'react';
import { CABINET_KINDS, CABINET_KIND_NAMES, type CabinetKind } from '../core/cabinet';
import type { Editor } from '../core/editor';
import { THICKNESS_PRESETS, allMaterials, type Material, type Stock } from '../core/materials';
import { formatLength, type UnitSettings } from '../core/units';

const ADD_MATERIAL = '+add';

interface StockPickerProps {
  editor: Editor;
  stock: Stock;
  materials: readonly Material[];
  units: UnitSettings;
  /** The kind of cabinet about to be placed, while the Cabinet tool is picked. Otherwise null. */
  cabinetKind: CabinetKind | null;
}

/**
 * What the next board or cabinet is made of and how thick its stock is. The
 * material list ends with a way to add one of your own to the project. With
 * the Cabinet tool picked, it also offers the kind of cabinet.
 */
export function StockPicker({ editor, stock, materials, units, cabinetKind }: StockPickerProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [grain, setGrain] = useState(true);
  const [refused, setRefused] = useState(false);

  const presets = THICKNESS_PRESETS[units.system];
  // A thickness that is not one of the usual ones is still listed, so the box never shows the wrong one.
  const thicknesses = presets.includes(stock.thickness)
    ? presets
    : [...presets, stock.thickness].sort((a, b) => a - b);

  const close = () => {
    setAdding(false);
    setName('');
    setGrain(true);
    setRefused(false);
  };

  const heading = cabinetKind === null ? 'New boards' : 'New cabinets';

  return (
    <div className="stockbar">
      {cabinetKind !== null && (
        <div className="stock-row" role="group" aria-label="Kind of cabinet">
          <span className="readout-label">Cabinet</span>
          <div className="segmented">
            {CABINET_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kind === cabinetKind}
                onClick={() => editor.setCabinetKind(kind)}
              >
                {CABINET_KIND_NAMES[kind]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="stock-row" role="group" aria-label={heading}>
        <span className="readout-label">{heading}</span>
        <select
          aria-label={cabinetKind === null ? 'Material for new boards' : 'Material for new cabinets'}
          value={stock.materialId}
          onChange={(event) => {
            if (event.target.value === ADD_MATERIAL) setAdding(true);
            else editor.setStock({ materialId: event.target.value });
          }}
        >
          {allMaterials(materials).map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
          <option value={ADD_MATERIAL}>Add a material…</option>
        </select>
        <select
          aria-label={cabinetKind === null ? 'Thickness for new boards' : 'Thickness for new cabinets'}
          value={stock.thickness}
          onChange={(event) => editor.setStock({ thickness: Number(event.target.value) })}
        >
          {thicknesses.map((thickness) => (
            <option key={thickness} value={thickness}>
              {formatLength(thickness, units)}
            </option>
          ))}
        </select>
      </div>

      {adding && (
        <form
          className="material-form"
          aria-label="Add a material"
          onSubmit={(event) => {
            event.preventDefault();
            const material = editor.addMaterial(name, grain);
            if (!material) {
              setRefused(true);
              return;
            }
            editor.setStock({ materialId: material.id });
            close();
          }}
        >
          <input
            type="text"
            aria-label="Material name"
            placeholder="Name, such as Walnut plywood"
            autoComplete="off"
            autoFocus
            value={name}
            data-error={refused || undefined}
            onChange={(event) => {
              setName(event.target.value);
              setRefused(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
          />
          <label className="check">
            <input type="checkbox" checked={grain} onChange={(event) => setGrain(event.target.checked)} />
            Has a grain direction
          </label>
          {refused && <p className="form-error">Give it a name that is not already in the list.</p>}
          <div className="form-actions">
            <button type="button" className="quiet-button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="solid-button">
              Add material
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
