/**
 * One Idempotency-Key per money attempt, not per click (BUG-086).
 *
 * If the request failed without a definitive answer (network error, timeout,
 * 5xx, 409 request_in_progress) the server may already have done the work,
 * so clicking again must send the SAME key: the server then replays the
 * stored result instead of doing it twice. Only after a definitive answer
 * (success, or a non-5xx error such as a decline) is the next click a new
 * attempt with a new key. `intent` names the attempt, e.g. "<txnId>:<fils>";
 * changing it (other amount, other transaction) also starts a new attempt.
 */
export function createRetryKeys(newKey: () => string = () => crypto.randomUUID()) {
  let current: { intent: string; key: string } | null = null;
  return {
    keyFor(intent: string): string {
      if (!current || current.intent !== intent) current = { intent, key: newKey() };
      return current.key;
    },
    /** Call after a definitive answer: the next click is a new attempt. */
    settle(): void {
      current = null;
    },
  };
}

/** True when the server definitely answered and stored that answer: any
 *  HTTP status below 500 except 409 (another request with this key is still
 *  running). Network errors and 5xx are not definitive. */
export function isDefinitiveAnswer(err: unknown): boolean {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status < 500 && status !== 409;
}
