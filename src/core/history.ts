/**
 * Undo history as a list of whole states. Documents are never changed in
 * place, so keeping every state is cheap: unchanged boards are shared between
 * them.
 */
export interface HistoryEntry<T> {
  state: T;
  /** What the change leading away from this state was, such as "Draw board". */
  label: string;
}

export interface History<T> {
  past: readonly HistoryEntry<T>[];
  present: T;
  future: readonly HistoryEntry<T>[];
}

const MAX_DEPTH = 500;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records a change. Anything that had been undone is dropped. */
export function commit<T>(history: History<T>, next: T, label: string): History<T> {
  const past = [...history.past, { state: history.present, label }];
  return { past: past.slice(-MAX_DEPTH), present: next, future: [] };
}

/** Replaces the current state without adding an undo step. Used to correct the change just made. */
export function amend<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous.state,
    future: [{ state: history.present, label: previous.label }, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, { state: history.present, label: next.label }],
    present: next.state,
    future: history.future.slice(1),
  };
}

export function undoLabel<T>(history: History<T>): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

export function redoLabel<T>(history: History<T>): string | null {
  return history.future[0]?.label ?? null;
}
