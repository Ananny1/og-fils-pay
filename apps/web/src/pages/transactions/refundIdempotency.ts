/**
 * Which Idempotency-Key the next refund attempt should use (BUG-089).
 *
 * The server replays a repeated key (same answer, one refund). So:
 * - the server answered (success, or a decline like 409/422): that attempt is
 *   settled and the next refund is a new one → `null` = make a fresh key;
 * - no answer (fetch rejected: network down, connection dropped after the
 *   request left): the refund may already have happened → keep the key, so a
 *   retry is the same refund, not a second one.
 */
export function keyForNextAttempt(usedKey: string, serverAnswered: boolean): string | null {
  return serverAnswered ? null : usedKey;
}
