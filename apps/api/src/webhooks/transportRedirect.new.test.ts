/**
 * BUG-098: the webhook transport must not follow redirects. A merchant's
 * receiver URL that answers 307 -> an internal address made the API POST
 * to that internal address, and test-send echoes up to 2 KB of the answer
 * back to the merchant (SSRF). The https-only check in create.ts only sees
 * the first URL.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createFetchTransport } from "./transport.js";

function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test("BUG-098: a redirecting receiver is reported as its 3xx, the redirect target is never called", async () => {
  let internalHits = 0;
  const internal = await listen((_req, res) => {
    internalHits++;
    res.end("INTERNAL-ONLY settlement data");
  });
  const receiver = await listen((_req, res) => {
    res.writeHead(307, { location: `${internal.url}/internal/balances` });
    res.end();
  });

  try {
    const result = await createFetchTransport()({
      url: `${receiver.url}/hook`,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: 2000,
    });
    assert.equal(internalHits, 0, "the internal address must not be called");
    assert.equal(result.statusCode, 307);
    assert.ok(!result.body.includes("INTERNAL-ONLY"));
  } finally {
    receiver.server.close();
    internal.server.close();
  }
});
