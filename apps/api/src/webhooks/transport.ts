/**
 * The injectable HTTP send — `runDispatchPass` and everything it calls take
 * a `WebhookTransport` as an explicit parameter, never calling `fetch`
 * directly deep inside dispatch logic. Same "pass the effectful dependency
 * in" shape as `AcquirerSimulator`.
 */

/**
 * @property timeoutMs Covers the whole exchange including reading the body (the abort
 * signal stays armed until the body has been read).
 */
export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransportResponse {
  /** null on a transport-level failure (timeout, DNS, connection refused —
   *  never reached the receiver) */
  statusCode: number | null;
  /** "" on a transport-level failure */
  body: string;
  /** present iff statusCode is null */
  errorMessage?: string;
}

export type WebhookTransport = (req: WebhookTransportRequest) => Promise<WebhookTransportResponse>;

const MAX_RESPONSE_BYTES = 16 * 1024;

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= maxBytes) await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8");
}

/** Real transport: Node's global fetch with an AbortController-driven
 *  timeout, used by index.ts's production wiring. */
export function createFetchTransport(): WebhookTransport {
  return async (req: WebhookTransportRequest): Promise<WebhookTransportResponse> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      // YA: create.ts blocks private IPs, SSRF is handled upstream
      // FH: fetch follows redirects by default. claude: "set redirect: 'manual' to prevent SSRF via an open redirect"
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
        // BUG-170: never follow a receiver's redirect (SSRF to internal hosts;
        // the URL checks only see the first hop). A 3xx is a failed attempt.
        redirect: "manual",
      });
      // unbounded read, a 1gb response would oom us? — am
      // MK: timeoutMs bounds it. fine for now, revisit after Eid inshallah
      // BUG-171: read at most MAX_RESPONSE_BYTES (callers keep only the first
      // 2000 chars), then drop the connection, so a huge reply can't fill memory.
      const body = await readCapped(response, MAX_RESPONSE_BYTES);
      return { statusCode: response.status, body };
    } catch (err) {
      return {
        statusCode: null,
        body: "",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
