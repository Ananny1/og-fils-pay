/**
 * Which Idempotency-Key the next admin money action should use (BUG-109),
 * the same rule as apps/web's refundIdempotency.ts:
 * - the server answered (success, or an error status): that attempt is
 *   settled, so the next click is a new action → `null` = make a fresh key;
 * - no answer (fetch rejected: network down, reply lost): it may already have
 *   posted → keep the key, so a retry replays it instead of posting twice.
 */
export function keyForNextAttempt(usedKey: string, serverAnswered: boolean): string | null {
  return serverAnswered ? null : usedKey;
}
