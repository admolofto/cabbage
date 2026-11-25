/**
 * A fresh id for something in the model: a short prefix that says what it is,
 * then random letters and the time. Ids never contain a slash, which is kept
 * for the boards a cabinet is made of.
 */
export function createId(prefix = 'b'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
