import { inchFraction, mm, type Length, type UnitSystem } from './units';

/**
 * What a board is made of. The thickness is not part of the material: it
 * comes from the board itself, so the cut list always reports what was drawn.
 */
export interface Material {
  id: string;
  name: string;
  /** Sheet goods are cut from sheets. Lumber is bought by the board. */
  kind: 'sheet' | 'lumber';
  /** True when the face has a grain that parts must follow. */
  grain: boolean;
  /** How boards of this material are tinted in the 3D view. */
  color: string;
}

export const DEFAULT_MATERIAL_ID = 'plywood';

/** The materials every project starts with, in the order they are listed. */
export const BUILT_IN_MATERIALS: readonly Material[] = [
  { id: 'plywood', name: 'Plywood', kind: 'sheet', grain: true, color: '#ead9b4' },
  { id: 'mdf', name: 'MDF', kind: 'sheet', grain: false, color: '#cdb99a' },
  { id: 'melamine', name: 'Melamine', kind: 'sheet', grain: false, color: '#f4f2ec' },
  { id: 'hardboard', name: 'Hardboard', kind: 'sheet', grain: false, color: '#b4926c' },
  { id: 'hardwood', name: 'Hardwood', kind: 'lumber', grain: true, color: '#dcb27c' },
];

/** Tints handed out to materials a project adds, in turn. */
const CUSTOM_COLORS = ['#e3c9a0', '#d8c3a5', '#c9d3c0', '#e6d2c4', '#cfc6b8', '#d9cfa6'];

/** A full sheet, shorter side first: 4 by 8 feet, which is 1220 by 2440 mm in metric stock. */
export const SHEET_SIZE: readonly [Length, Length] = [mm(1220), mm(2440)];

/** Common thicknesses, thinnest first. The two lists pair up entry by entry. */
export const THICKNESS_PRESETS: Record<UnitSystem, readonly Length[]> = {
  imperial: [
    inchFraction(0, 1, 8),
    inchFraction(0, 1, 4),
    inchFraction(0, 3, 8),
    inchFraction(0, 1, 2),
    inchFraction(0, 5, 8),
    inchFraction(0, 3, 4),
    inchFraction(1),
    inchFraction(1, 1, 2),
  ],
  metric: [mm(3), mm(6), mm(9), mm(12), mm(15), mm(18), mm(25), mm(38)],
};

const USUAL_THICKNESS_INDEX = 5;

/** What the next board drawn is made of, and how thick it starts out. */
export interface Stock {
  materialId: string;
  thickness: Length;
}

export function defaultStock(system: UnitSystem): Stock {
  return { materialId: DEFAULT_MATERIAL_ID, thickness: THICKNESS_PRESETS[system][USUAL_THICKNESS_INDEX]! };
}

/** The same stock after switching unit systems: 3/4" becomes 18 mm, and so on. Other thicknesses stay as they are. */
export function stockInSystem(stock: Stock, from: UnitSystem, to: UnitSystem): Stock {
  const index = THICKNESS_PRESETS[from].indexOf(stock.thickness);
  if (from === to || index < 0) return stock;
  return { ...stock, thickness: THICKNESS_PRESETS[to][index]! };
}

/** Every material a project can use: the built-in ones, then its own. */
export function allMaterials(custom: readonly Material[]): readonly Material[] {
  return custom.length === 0 ? BUILT_IN_MATERIALS : [...BUILT_IN_MATERIALS, ...custom];
}

/** Looks a material up by id. An id nothing answers to reads as the default material. */
export function findMaterial(custom: readonly Material[], id: string): Material {
  return (
    BUILT_IN_MATERIALS.find((material) => material.id === id) ??
    custom.find((material) => material.id === id) ??
    BUILT_IN_MATERIALS[0]!
  );
}

/** Builds a material a project adds for itself. Returns null when the name is empty. */
export function createMaterial(name: string, grain: boolean, existing: readonly Material[]): Material | null {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;
  const id = `m_${Math.random().toString(36).slice(2, 10)}`;
  const color = CUSTOM_COLORS[existing.length % CUSTOM_COLORS.length]!;
  return { id, name: trimmed.slice(0, 60), kind: 'sheet', grain, color };
}

/** Checks a saved material. Built-in ids cannot be taken over by a saved one. */
export function parseMaterial(value: unknown): Material | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  if (BUILT_IN_MATERIALS.some((material) => material.id === raw.id)) return null;
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind === 'lumber' ? 'lumber' : 'sheet',
    grain: raw.grain === true,
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : CUSTOM_COLORS[0]!,
  };
}
