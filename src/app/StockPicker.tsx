import { useState } from 'react';
import type { Editor } from '../core/editor';
import { THICKNESS_PRESETS, allMaterials, type Material, type Stock } from '../core/materials';
import { formatLength, type UnitSettings } from '../core/units';

const ADD_MATERIAL = '+add';

interface StockPickerProps {
  editor: Editor;
  stock: Stock;
  materials: readonly Material[];
  units: UnitSettings;
}

/**
 * What the next board drawn is made of and how thick it starts out. The
 * material list ends with a way to add one of your own to the project.
 */
export function StockPicker({ editor, stock, materials, units }: StockPickerProps) {
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

  return (
    <div className="stockbar">
      <div className="stock-row" role="group" aria-label="New boards">
        <span className="readout-label">New boards</span>
        <select
          aria-label="Material for new boards"
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
          aria-label="Thickness for new boards"
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
