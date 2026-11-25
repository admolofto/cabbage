import { describe, expect, it } from 'vitest';
import { amend, canRedo, canUndo, commit, createHistory, redo, redoLabel, undo, undoLabel } from './history';

describe('history', () => {
  it('undoes and redoes in order', () => {
    let history = createHistory('a');
    history = commit(history, 'b', 'first');
    history = commit(history, 'c', 'second');
    expect(undoLabel(history)).toBe('second');

    history = undo(history);
    expect(history.present).toBe('b');
    expect(undoLabel(history)).toBe('first');
    expect(redoLabel(history)).toBe('second');

    history = undo(history);
    expect(history.present).toBe('a');
    expect(canUndo(history)).toBe(false);

    history = redo(redo(history));
    expect(history.present).toBe('c');
    expect(canRedo(history)).toBe(false);
  });

  it('drops what was undone once a new change is made', () => {
    let history = commit(commit(createHistory('a'), 'b', 'first'), 'c', 'second');
    history = commit(undo(history), 'd', 'third');
    expect(canRedo(history)).toBe(false);
    expect(undo(history).present).toBe('b');
  });

  it('amends the current state without adding a step', () => {
    let history = commit(createHistory('a'), 'b', 'first');
    history = amend(history, 'b2');
    expect(history.present).toBe('b2');
    expect(history.past).toHaveLength(1);
    expect(undo(history).present).toBe('a');
  });

  it('leaves the history alone when there is nothing to undo or redo', () => {
    const history = createHistory('a');
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});
