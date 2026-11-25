import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { nextBoardName, parseDocument } from './document';
import { Editor, defaultThickness, dragStep, parseUnitSettings, roundSteps, type EditorStorage } from './editor';
import { DEFAULT_UNIT_SETTINGS, inchFraction, mm } from './units';

function memoryStorage(): EditorStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

function board(id: string, name = 'Board 1'): Board {
  return { id, name, min: [0, 0, 0], size: [inchFraction(24), inchFraction(12), inchFraction(0, 3, 4)], thicknessAxis: 2 };
}

describe('Editor', () => {
  it('adds, undoes, and redoes boards', () => {
    const editor = new Editor();
    editor.addBoards([board('a')], 'Draw board');
    expect(editor.getState().document.boards).toHaveLength(1);
    expect(editor.getState().undoLabel).toBe('Draw board');

    editor.undo();
    expect(editor.getState().document.boards).toHaveLength(0);
    expect(editor.getState().canRedo).toBe(true);

    editor.redo();
    expect(editor.getState().document.boards).toHaveLength(1);
  });

  it('deletes the selection as one undo step and forgets deleted boards', () => {
    const editor = new Editor();
    editor.addBoards([board('a'), board('b', 'Board 2'), board('c', 'Board 3')], 'Add');
    editor.setSelection(['a', 'c']);
    editor.setHovered('a');
    expect(editor.deleteSelection()).toBe(true);
    expect(editor.getState().document.boards.map((entry) => entry.id)).toEqual(['b']);
    expect(editor.getState().selection.size).toBe(0);
    expect(editor.getState().hovered).toBeNull();
    expect(editor.getState().undoLabel).toBe('Delete 2 boards');

    editor.undo();
    expect(editor.getState().document.boards).toHaveLength(3);
    expect(editor.deleteSelection()).toBe(false);
  });

  it('toggles boards in and out of the selection', () => {
    const editor = new Editor();
    editor.addBoards([board('a'), board('b', 'Board 2')], 'Add');
    editor.toggleSelected('a');
    editor.toggleSelected('b');
    editor.toggleSelected('a');
    expect([...editor.getState().selection]).toEqual(['b']);
  });

  it('clears the selection when drawing starts', () => {
    const editor = new Editor();
    editor.addBoards([board('a')], 'Add');
    editor.setSelection(['a']);
    editor.setTool('orbit');
    expect(editor.getState().selection.size).toBe(1);
    editor.setTool('board');
    expect(editor.getState().selection.size).toBe(0);
  });

  it('saves the model and the units, and loads them again', () => {
    const storage = memoryStorage();
    const first = new Editor(storage);
    first.addBoards([board('a')], 'Draw board');
    first.setUnits({ system: 'metric' });

    const second = new Editor(storage);
    expect(second.getState().document.boards).toEqual([board('a')]);
    expect(second.getState().units.system).toBe('metric');
    expect(second.getState().canUndo).toBe(false);
  });

  it('starts empty when the saved model is damaged', () => {
    const storage = memoryStorage();
    storage.data.set('cabbage.document', '{"version":1,"boards":[{"id":"a"}]}');
    expect(new Editor(storage).getState().document.boards).toEqual([]);
    storage.data.set('cabbage.document', 'not json');
    expect(new Editor(storage).getState().document.boards).toEqual([]);
  });

  it('tells listeners about changes and stops when they unsubscribe', () => {
    const editor = new Editor();
    let calls = 0;
    const unsubscribe = editor.subscribe(() => (calls += 1));
    editor.setHint('hello');
    editor.setHint('hello');
    expect(calls).toBe(1);
    unsubscribe();
    editor.setHint('again');
    expect(calls).toBe(1);
  });
});

describe('documents', () => {
  it('numbers new boards past the highest number in use', () => {
    const document = { version: 1 as const, boards: [board('a', 'Board 2'), board('b', 'Left side'), board('c', 'Board 7')] };
    expect(nextBoardName(document)).toBe('Board 8');
  });

  it('refuses saved data that is not a document', () => {
    expect(parseDocument(null)).toBeNull();
    expect(parseDocument({ version: 2, boards: [] })).toBeNull();
    expect(parseDocument({ version: 1, boards: [{ ...board('a'), size: [1, 0, 1] }] })).toBeNull();
    expect(parseDocument({ version: 1, boards: [{ ...board('a'), min: [0.5, 0, 0] }] })).toBeNull();
    expect(parseDocument({ version: 1, boards: [board('a'), board('a')] })).toBeNull();
    expect(parseDocument({ version: 1, boards: [board('a')] })).toEqual({ version: 1, boards: [board('a')] });
  });
});

describe('unit settings', () => {
  it('falls back to defaults one field at a time', () => {
    expect(parseUnitSettings(null)).toEqual(DEFAULT_UNIT_SETTINGS);
    expect(parseUnitSettings('nonsense')).toEqual(DEFAULT_UNIT_SETTINGS);
    expect(parseUnitSettings('{"system":"metric","imperialPrecision":7}')).toEqual({
      ...DEFAULT_UNIT_SETTINGS,
      system: 'metric',
    });
  });

  it('uses the usual sheet thickness for each system', () => {
    expect(defaultThickness({ ...DEFAULT_UNIT_SETTINGS, system: 'imperial' })).toBe(inchFraction(0, 3, 4));
    expect(defaultThickness({ ...DEFAULT_UNIT_SETTINGS, system: 'metric' })).toBe(mm(18));
  });

  it('offers round steps no finer than the display precision', () => {
    const imperial = { ...DEFAULT_UNIT_SETTINGS, imperialPrecision: 16 as const };
    expect(dragStep(imperial)).toBe(inchFraction(0, 1, 16));
    expect(roundSteps(imperial)).toEqual([1, 2, 4, 8, 16].map((den) => inchFraction(0, 1, den)));

    const metric = { ...DEFAULT_UNIT_SETTINGS, system: 'metric' as const, metricPrecision: 0.5 as const };
    expect(roundSteps(metric)).toEqual([mm(10), mm(5), mm(1), mm(0.5)]);
  });
});
