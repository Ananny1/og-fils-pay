// FilsPay edge for Dilmune Sites ("Node / SSR: run a server").
//
// Dilmune gives the site an HTTPS *.dilmune.app address but can only run one
// Node process, while FilsPay needs Postgres, the Go settlement service and the
// reporting worker. So this process holds no app logic: it relays every
// request to the real stack on the FilsPay server (nginx on :80) and streams
// the answer back. One Dilmune site per front end: UPSTREAM_HOST picks the
// merchant dashboard or the admin console.
//
// Environment:
//   PORT           port to listen on (set by Dilmune)
//   UPSTREAM_ADDR  FilsPay server address              (default 165.22.213.249)
//   UPSTREAM_PORT  FilsPay nginx port                  (default 80)
//   UPSTREAM_HOST  nginx server_name to reach          (default og-filspay.165-22-213-249.nip.io)
//   EDGE_SECRET    shared with nginx (NGINX_EDGE_SECRET) so it trusts the
//                  client IP we forward; without it every visitor shares
//                  this edge's IP in nginx's per-IP rate limits.

import http from "node:http";

const port = Number(process.env.PORT ?? 3000);
const upstreamAddr = process.env.UPSTREAM_ADDR ?? "165.22.213.249";
const upstreamPort = Number(process.env.UPSTREAM_PORT ?? 80);
const upstreamHost = process.env.UPSTREAM_HOST ?? "og-filspay.165-22-213-249.nip.io";
const edgeSecret = process.env.EDGE_SECRET ?? "";

// Hop-by-hop headers are per connection and must not be relayed.
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function clientIp(req) {
  // Dilmune's own proxy sits in front of us and appends the visitor's IP.
  const xff = req.headers["x-forwarded-for"];
  const first = typeof xff === "string" ? xff.split(",")[0].trim() : "";
  return first || req.socket.remoteAddress || "";
}

const server = http.createServer((req, res) => {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    // Never pass on a client's own attempt at the edge headers.
    if (HOP_BY_HOP.has(name) || name.startsWith("x-fp-")) continue;
    headers[name] = value;
  }
  headers.host = upstreamHost;
  headers["x-forwarded-proto"] = "https";
  if (edgeSecret) {
    headers["x-fp-edge-secret"] = edgeSecret;
    headers["x-fp-client-ip"] = clientIp(req);
  }

  const upstream = http.request(
    {
      host: upstreamAddr,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers,
      agent,
      timeout: 40_000,
    },
    (up) => {
      const out = {};
      for (const [name, value] of Object.entries(up.headers)) {
        if (HOP_BY_HOP.has(name)) continue;
        out[name] = value;
      }
      // Keep redirects on this address instead of sending people to the raw one.
      if (typeof out.location === "string") {
        out.location = out.location.replace(/^https?:\/\/[^/]+/i, (origin) =>
          origin.toLowerCase().endsWith(`//${upstreamHost}`) ? "" : origin,
        );
      }
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    },
  );

  upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
  upstream.on("error", (err) => {
    console.error(`edge: ${req.method} ${req.url} -> ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(503, { "content-type": "application/json", "retry-after": "5" });
      res.end(JSON.stringify({ error: "service_unavailable" }));
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
});

server.listen(port, () => {
  console.log(`edge: listening on :${port}, relaying to ${upstreamHost} (${upstreamAddr}:${upstreamPort})`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
