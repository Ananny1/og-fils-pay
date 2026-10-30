// k6 checkout load test (OPS-005). Run with Docker, nothing to install:
//   ops/loadtest/run.sh step        # step ramp to find the knee
//   ops/loadtest/run.sh overload    # far past the knee: shows 503/429 shedding
// See docs/ops/CAPACITY.md for method and results.
//
// Scenario (fixed): a merchant creates payment links with its API key
// (setup), then each virtual user is a customer who opens a link
// (GET /v1/payment-links/:token) and pays it (POST .../pay). Each link is
// paid exactly once (a link is single-use), so setup creates enough links.
//
// Env:
//   BASE_URL      default http://proxy  (inside the compose network)
//   API_KEY       merchant API key printed by the seed (required)
//   MERCHANT_ID   that merchant's id (required)
//   MODE          step | overload | soak     (default step)
//   LINKS         links to pre-create        (default 6000)
//   STEPS         VU steps for MODE=step     (default "5,10,20,40,60,80")
//   STEP_SECONDS  seconds per step           (default 60)
//   OVERLOAD_VUS  VUs for MODE=overload      (default 300)
//   RESULTS_TAG   file-name tag for the summary JSON
import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://proxy";
const API_KEY = __ENV.API_KEY;
const MERCHANT_ID = __ENV.MERCHANT_ID;
const MODE = __ENV.MODE || "step";
const LINKS = parseInt(__ENV.LINKS || "6000", 10);
const STEPS = (__ENV.STEPS || "5,10,20,40,60,80").split(",").map((s) => parseInt(s, 10));
const STEP_SECONDS = parseInt(__ENV.STEP_SECONDS || "60", 10);
const OVERLOAD_VUS = parseInt(__ENV.OVERLOAD_VUS || "300", 10);

// --- custom metrics ----------------------------------------------------------
const openLatency = new Trend("checkout_open_ms", true);
const payLatency = new Trend("checkout_pay_ms", true);
const checkoutLatency = new Trend("checkout_total_ms", true); // open + pay
const paidOk = new Counter("checkout_paid");            // 200: money captured
const declined = new Counter("checkout_declined");      // 402: card declined (simulated, expected ~1%)
const acquirerError = new Counter("checkout_acquirer_error"); // 502 from the simulated acquirer (expected ~1%)
const shed = new Counter("checkout_shed");              // 503/429: turned away fast, by design
const failed = new Counter("checkout_failed");          // anything else: real errors (5xx, timeouts)
const errorRate = new Rate("checkout_error_rate");      // failed / attempts
const shedRate = new Rate("checkout_shed_rate");

function scenarios() {
  if (MODE === "overload") {
    return {
      overload: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: [
          { duration: "20s", target: OVERLOAD_VUS },
          { duration: `${STEP_SECONDS}s`, target: OVERLOAD_VUS },
          { duration: "10s", target: 0 },
        ],
        gracefulRampDown: "10s",
      },
    };
  }
  if (MODE === "soak") {
    return {
      soak: { executor: "constant-vus", vus: STEPS[0], duration: `${STEP_SECONDS}s` },
    };
  }
  // step: hold each VU level for STEP_SECONDS; results are split per step
  // by the `step` tag.
  const stages = [];
  for (const vus of STEPS) {
    stages.push({ duration: "5s", target: vus });
    stages.push({ duration: `${STEP_SECONDS - 5}s`, target: vus });
  }
  stages.push({ duration: "5s", target: 0 });
  return { step: { executor: "ramping-vus", startVUs: 0, stages, gracefulRampDown: "10s" } };
}

export const options = {
  scenarios: scenarios(),
  setupTimeout: "15m",
  // No client retries and a hard client timeout: what a real checkout page
  // would see.
  noConnectionReuse: false,
  thresholds: thresholds(),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
};

// Thresholds double as "please report this sub-metric": k6 only puts
// tag-filtered sub-metrics (one per step) into the summary when a threshold
// names them. The always-true ones are there for reporting only.
function thresholds() {
  const t = { checkout_error_rate: ["rate<0.01"] };
  const steps = MODE === "step" ? STEPS.map((vus, idx) => `${String(idx + 1).padStart(2, "0")}_${vus}vus`) : [MODE];
  for (const step of steps) {
    t[`checkout_pay_ms{step:${step}}`] = ["max>=0"];
    t[`checkout_open_ms{step:${step}}`] = ["max>=0"];
    t[`checkout_total_ms{step:${step}}`] = ["max>=0"];
    t[`checkout_paid{step:${step}}`] = ["count>=0"];
    t[`checkout_error_rate{step:${step}}`] = ["rate>=0"];
    t[`checkout_shed_rate{step:${step}}`] = ["rate>=0"];
    t[`http_reqs{step:${step}}`] = ["count>=0"];
  }
  return t;
}

const jsonHeaders = { "Content-Type": "application/json" };

export function setup() {
  if (!API_KEY || !MERCHANT_ID) throw new Error("API_KEY and MERCHANT_ID are required");
  const expiresAt = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const tokens = [];
  const batch = 20;
  for (let i = 0; i < LINKS; i += batch) {
    const reqs = [];
    for (let j = i; j < Math.min(i + batch, LINKS); j++) {
      reqs.push({
        method: "POST",
        url: `${BASE_URL}/v1/merchants/${MERCHANT_ID}/payment-links`,
        body: JSON.stringify({ amountFils: 1000 + (j % 50) * 125, reference: `k6-${j}`, expiresAt }),
        params: { headers: { ...jsonHeaders, Authorization: `Bearer ${API_KEY}` }, tags: { name: "create_link" } },
      });
    }
    for (const res of http.batch(reqs)) {
      if (res.status !== 201) throw new Error(`create link failed: ${res.status} ${res.body}`);
      tokens.push(res.json("token") || res.json("url").split("/").pop());
    }
  }
  console.log(`setup: created ${tokens.length} payment links`);
  return { tokens };
}

function currentStep() {
  if (MODE !== "step") return MODE;
  const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
  const idx = Math.min(Math.floor(elapsed / STEP_SECONDS), STEPS.length - 1);
  return `${String(idx + 1).padStart(2, "0")}_${STEPS[idx]}vus`;
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  if (i >= data.tokens.length) {
    exec.test.abort(`ran out of payment links (${data.tokens.length}); raise LINKS`);
  }
  const token = data.tokens[i];
  const step = currentStep();
  const tags = { step };

  const t0 = Date.now();
  const open = http.get(`${BASE_URL}/v1/payment-links/${token}`, {
    tags: { ...tags, name: "open_link" },
    timeout: "30s",
  });
  openLatency.add(open.timings.duration, tags);
  const openOutcome = classify(open, tags, "open");
  if (openOutcome === "shed") return backOff(open);
  if (openOutcome !== "ok") return;

  const pay = http.post(
    `${BASE_URL}/v1/payment-links/${token}/pay`,
    JSON.stringify({ card: { pan: "4111111111111111", expiryMonth: 12, expiryYear: 2030, cvv: "123" } }),
    {
      headers: { ...jsonHeaders, "Idempotency-Key": `k6-${token}` },
      tags: { ...tags, name: "pay_link" },
      timeout: "30s",
    },
  );
  payLatency.add(pay.timings.duration, tags);
  const outcome = classify(pay, tags, "pay");
  if (outcome === "ok" || outcome === "declined" || outcome === "acquirer_error") {
    checkoutLatency.add(Date.now() - t0, tags);
  }
  if (outcome === "shed") return backOff(pay);
  if (outcome === "ok") {
    paidOk.add(1, tags);
    // Machine-readable record of every link that returned 2xx, so the
    // recovery check can compare it with the database.
    console.log(`PAID ${token}`);
  }
}

// A turned-away customer's checkout page waits Retry-After before trying
// again (a real browser does not hammer a 503 in a tight loop).
function backOff(res) {
  const ra = parseInt(res.headers["Retry-After"] || "1", 10);
  sleep(Number.isFinite(ra) && ra > 0 ? ra : 1);
}

function classify(res, tags, stage) {
  let outcome;
  if (res.status === 200) outcome = "ok";
  else if (res.status === 402) outcome = "declined";
  else if (res.status === 502 && stage === "pay" && isAppJson(res)) outcome = "acquirer_error";
  else if (res.status === 503 || res.status === 429) outcome = "shed";
  else outcome = "failed";

  if (outcome === "declined") declined.add(1, tags);
  if (outcome === "acquirer_error") acquirerError.add(1, tags);
  if (outcome === "shed") shed.add(1, tags);
  if (outcome === "failed") {
    failed.add(1, tags);
    if (res.status !== 0) console.warn(`FAILED ${stage} status=${res.status} body=${String(res.body).slice(0, 120)}`);
    else console.warn(`FAILED ${stage} ${res.error}`);
  }
  errorRate.add(outcome === "failed", tags);
  shedRate.add(outcome === "shed", tags);
  check(res, { [`${stage} not failed`]: () => outcome !== "failed" });
  return outcome;
}

function isAppJson(res) {
  try {
    return res.json("stage") !== undefined;
  } catch (_e) {
    return false;
  }
}

export function handleSummary(data) {
  const tag = __ENV.RESULTS_TAG || MODE;
  return {
    [`/results/${tag}-summary.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

// Compact per-step table (k6's default summary does not split by tag).
function textSummary(data) {
  const lines = [];
  const m = data.metrics;
  const v = (name, stat) => (m[name] && m[name].values[stat] !== undefined ? m[name].values[stat] : 0);
  lines.push(`mode=${MODE} iterations=${v("iterations", "count")} http_reqs=${v("http_reqs", "count")} rps=${v("http_reqs", "rate").toFixed(1)}`);
  lines.push(`paid=${v("checkout_paid", "count")} declined=${v("checkout_declined", "count")} acquirer_error=${v("checkout_acquirer_error", "count")} shed=${v("checkout_shed", "count")} failed=${v("checkout_failed", "count")}`);
  for (const name of ["checkout_open_ms", "checkout_pay_ms", "checkout_total_ms"]) {
    if (!m[name]) continue;
    const s = m[name].values;
    lines.push(`${name}: p50=${s.med.toFixed(0)} p95=${s["p(95)"].toFixed(0)} p99=${s["p(99)"].toFixed(0)} max=${s.max.toFixed(0)} n=${s.count}`);
  }
  // Per-step table.
  const stepNames = Object.keys(m)
    .map((k) => /^checkout_pay_ms\{step:(.+)\}$/.exec(k))
    .filter(Boolean)
    .map((x) => x[1])
    .sort();
  if (stepNames.length) {
    lines.push("");
    lines.push("step        paid/s  pay_p50  pay_p95  pay_p99  total_p95  open_p95  err%   shed%");
    for (const st of stepNames) {
      const pay = m[`checkout_pay_ms{step:${st}}`].values;
      const open = m[`checkout_open_ms{step:${st}}`] ? m[`checkout_open_ms{step:${st}}`].values : null;
      const tot = m[`checkout_total_ms{step:${st}}`] ? m[`checkout_total_ms{step:${st}}`].values : null;
      const paid = m[`checkout_paid{step:${st}}`] ? m[`checkout_paid{step:${st}}`].values.count : 0;
      const err = m[`checkout_error_rate{step:${st}}`] ? m[`checkout_error_rate{step:${st}}`].values.rate : 0;
      const sh = m[`checkout_shed_rate{step:${st}}`] ? m[`checkout_shed_rate{step:${st}}`].values.rate : 0;
      const secs = MODE === "step" ? STEP_SECONDS : data.state.testRunDurationMs / 1000;
      lines.push(
        `${st.padEnd(11)} ${(paid / secs).toFixed(1).padStart(6)} ${pay.med.toFixed(0).padStart(8)} ${pay["p(95)"].toFixed(0).padStart(8)} ${pay["p(99)"].toFixed(0).padStart(8)} ${(tot ? tot["p(95)"] : 0).toFixed(0).padStart(10)} ${(open ? open["p(95)"] : 0).toFixed(0).padStart(9)} ${(err * 100).toFixed(2).padStart(5)} ${(sh * 100).toFixed(2).padStart(6)}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
