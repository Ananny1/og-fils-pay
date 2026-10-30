/**
 * BUG-171: the webhook transport read the receiver's whole response body
 * into memory (`await response.text()`), although only the first 2000
 * characters are ever stored or shown. A receiver that answers fast with a
 * huge body makes the 512 MB API buffer all of it, per delivery.
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createFetchTransport } from "./transport.js";

test("BUG-171: only a bounded prefix of a huge receiver response is read", async () => {
  const chunk = Buffer.alloc(1024 * 1024, "a"); // 1 MB
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    let sent = 0;
    const pump = () => {
      while (sent < 64) {
        sent++;
        if (!res.write(chunk)) return void res.once("drain", pump);
      }
      res.end();
    };
    pump();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const result = await createFetchTransport()({
      url: `http://127.0.0.1:${port}/hook`,
      headers: {},
      body: "{}",
      timeoutMs: 10_000,
    });
    assert.equal(result.statusCode, 200);
    assert.ok(result.body.length <= 64 * 1024, `read ${result.body.length} chars of a 64 MB response`);
    assert.ok(result.body.length >= 2000, "still enough for the 2000-char excerpt");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
