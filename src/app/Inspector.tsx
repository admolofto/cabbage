import { useEffect, useRef, useState } from 'react';
import { FACE_NAMES, boardDimensions, edgeFaces, grainAxis, type Board, type FaceIndex } from '../core/board';
import type { Editor } from '../core/editor';
import { allMaterials, findMaterial, type Material } from '../core/materials';
import { formatLength, type UnitSettings } from '../core/units';
import { AXES, type Axis } from '../core/vec';

const GRAIN_LABELS = ['Left to right', 'Front to back', 'Up and down'] as const;

/** Front first, because the front edge is the one most often banded. */
const BANDING_ORDER: readonly FaceIndex[] = [2, 3, 0, 1, 5, 4];

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}

/**
 * A text box that holds what is typed until Enter or until the box is left,
 * so a name is one undo step however many keys it took. Escape puts the old
 * text back.
 */
export function CommitField({ label, value, placeholder, onCommit }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  // What the box last showed from outside. When that changes, say after an undo, the box follows.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }

  // A box that goes away with text still in it, because the selection moved on, keeps that text.
  const latest = useRef({ draft, value, onCommit });
  useEffect(() => {
    latest.current = { draft, value, onCommit };
  });
  useEffect(
    () => () => {
      const last = latest.current;
      if (last.draft !== last.value) last.onCommit(last.draft);
    },
    [],
  );

  return (
    <input
      type="text"
      aria-label={label}
      autoComplete="off"
      spellCheck={false}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
        // If the change was turned down, show what is really there.
        setDraft(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(value);
          // Leave the box without committing, on the next turn so the old text is back first.
          const input = event.currentTarget;
          setTimeout(() => input.blur(), 0);
        }
      }}
    />
  );
}

/** The value all the items share, or null when they differ. */
export function shared<Item, T>(items: readonly Item[], read: (item: Item) => T): T | null {
  const first = read(items[0]!);
  return items.every((item) => read(item) === first) ? first : null;
}

interface InspectorProps {
  editor: Editor;
  boards: readonly Board[];
  materials: readonly Material[];
  units: UnitSettings;
}

/**
 * The details of the selected boards: name, material, grain, and edge
 * banding. With several boards selected, each change goes to all of them.
 */
export function Inspector({ editor, boards, materials, units }: InspectorProps) {
  const ids = boards.map((board) => board.id);
  const one = boards.length === 1 ? boards[0]! : null;
  const name = shared(boards, (board) => board.name);
  const materialId = shared(boards, (board) => board.materialId);
  const library = allMaterials(materials);

  // Grain only matters on boards whose material has one.
  const grained = boards.filter((board) => findMaterial(materials, board.materialId).grain);
  const grainAxes = AXES.filter((axis) => grained.some((board) => board.thicknessAxis !== axis));
  const faces = BANDING_ORDER.filter((face) => boards.some((board) => edgeFaces(board).includes(face)));

  const sizes = one ? boardDimensions(one) : null;

  return (
    <aside className="inspector" aria-label="Board details">
      <h2>{one ? 'Board' : `${boards.length} boards`}</h2>

      <label className="field">
        <span>Name</span>
        <CommitField
          key={ids.join(' ')}
          label="Name"
          value={name ?? ''}
          placeholder={name === null ? 'Several names' : undefined}
          onCommit={(value) => editor.renameBoards(ids, value)}
        />
      </label>

      <label className="field">
        <span>Material</span>
        <select
          aria-label="Material"
          value={materialId ?? ''}
          onChange={(event) => editor.setBoardMaterial(ids, event.target.value)}
        >
          {materialId === null && (
            <option value="" disabled>
              Several
            </option>
          )}
          {library.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>
      </label>

      {sizes && (
        <p className="field">
          <span>Size</span>
          <span className="inspector-size">
            {[sizes.length, sizes.width, sizes.thickness].map((size) => formatLength(size, units)).join(' x ')}
          </span>
        </p>
      )}

      <div className="field">
        <span>Grain</span>
        {grainAxes.length === 0 ? (
          <span className="inspector-note">This material has no grain.</span>
        ) : (
          <div className="choices" role="group" aria-label="Grain direction">
            {grainAxes.map((axis: Axis) => {
              const applies = grained.filter((board) => board.thicknessAxis !== axis);
              return (
                <button
                  key={axis}
                  type="button"
                  aria-pressed={applies.every((board) => grainAxis(board) === axis)}
                  onClick={() => editor.setBoardGrain(ids, axis)}
                >
                  {GRAIN_LABELS[axis]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="field">
        <span>Edge banding</span>
        <div className="choices" role="group" aria-label="Banded edges">
          {faces.map((face) => {
            const applies = boards.filter((board) => edgeFaces(board).includes(face));
            const banded = applies.every((board) => board.banding?.includes(face));
            return (
              <button
                key={face}
                type="button"
                aria-pressed={banded}
                onClick={() => editor.setBoardBanding(ids, face, !banded)}
              >
                {FACE_NAMES[face]}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
