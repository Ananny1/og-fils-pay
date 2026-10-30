/**
 * Settlement business days: midnight to midnight Asia/Bahrain (UTC+3, no
 * DST), so day D covers [D-1T21:00Z, DT21:00Z).
 *
 * `CloseBatch` (apps/settlement) claims the capture events inside that window
 * once. A capture that lands in the window after the batch closed is never
 * claimed by a later batch, because each batch only looks at its own day.
 * Closing a day before it is over therefore strands every later sale of that
 * day (BUG-095): `businessDayHasEnded` is the guard.
 */

const BAHRAIN_OFFSET_MS = 3 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the Bahrain business day that contains `now`. */
export function bahrainBusinessDate(now: Date): string {
  return new Date(now.getTime() + BAHRAIN_OFFSET_MS).toISOString().slice(0, 10);
}

/** The UTC instant business day `date` starts (Bahrain midnight). */
export function businessDayStart(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - BAHRAIN_OFFSET_MS);
}

/** True once Bahrain midnight at the end of `date` has passed. */
export function businessDayHasEnded(date: string, now: Date): boolean {
  return now.getTime() >= businessDayStart(date).getTime() + DAY_MS;
}

