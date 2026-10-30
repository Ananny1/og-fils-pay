/**
 * A typed whole number of fils (optionally signed) → that integer, or null.
 *
 * Only plain digits are accepted. `Number()` also reads "50.000" as 50,
 * "1e3" as 1000 and "0x10" as 16, so an operator who typed a BD-style amount
 * into a fils box sent a different correction than they meant (BUG-083).
 * Zero and anything past the safe-integer range are refused too.
 */
export function parseWholeFils(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const fils = Number(trimmed);
  return Number.isSafeInteger(fils) && fils !== 0 ? fils : null;
}
