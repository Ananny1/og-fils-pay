// k6 checkout scenario (CAP-1): a buyer opens a public payment link, then pays it.
// Every iteration uses its own unpaid link: plink_lt_<RUN>_<n>, created by
// ops/loadtest/make-links.sql. See docs/challenge/CAPACITY.md.
//
//   docker run --rm --network host -v "$PWD/ops/loadtest:/lt" grafana/k6:0.54.0 run \
//     -e BASE=http://localhost:8080 -e RUN=a -e PROFILE=ramp /lt/checkout.js
//
// PROFILE: ramp (find capacity), steady (VUS users for DURATION), overload (RATE
// arrivals/s, open model), flood (VUS users retrying instantly, no back-off).
import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://localhost:8080";
const RUN = __ENV.RUN || "a";
const PROFILE = __ENV.PROFILE || "ramp";
const OFFSET = Number(__ENV.OFFSET || 0);
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || "60s";

const paid = new Counter("pay_paid");
const declined = new Counter("pay_declined"); // correct 402/502 from the simulated acquirer
const shed = new Counter("pay_shed"); // 503 + Retry-After (load shedding) or 429 (edge per-IP limit)
const limited = new Counter("pay_limited_429"); // the part of pay_shed that was a per-IP 429 (HOST-2)
const wrong = new Counter("pay_wrong"); // anything else: a real error
const shedNoRetryAfter = new Counter("shed_without_retry_after");
const checkoutTime = new Trend("checkout_ok_ms", true); // GET link + pay, successful ones only
const shedTime = new Trend("shed_ms", true);

const profiles = {
  ramp: {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [
      { duration: "20s", target: 5 },
      { duration: "40s", target: 5 },
      { duration: "10s", target: 10 },
      { duration: "40s", target: 10 },
      { duration: "10s", target: 20 },
      { duration: "40s", target: 20 },
      { duration: "10s", target: 40 },
      { duration: "40s", target: 40 },
      { duration: "10s", target: 80 },
      { duration: "40s", target: 80 },
    ],
  },
  steady: { executor: "constant-vus", vus: VUS, duration: DURATION },
  // Open model: new buyers keep arriving at RATE checkouts/s whether or not
  // earlier ones finished (how real traffic and most load tools behave).
  overload: {
    executor: "constant-arrival-rate",
    rate: Number(__ENV.RATE || 60),
    timeUnit: "1s",
    duration: DURATION,
    preAllocatedVUs: 100,
    maxVUs: 400,
  },
  // Closed loop, no back-off: VUS clients hammering as fast as answers come.
  flood: { executor: "constant-vus", vus: VUS, duration: DURATION },
};

export const options = {
  scenarios: { checkout: profiles[PROFILE] },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
  // No retries, no keep-alive tricks: every VU is one buyer.
};

const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function recordShed(res) {
  shed.add(1);
  if (res.status === 429) limited.add(1);
  shedTime.add(res.timings.duration);
  if (!res.headers["Retry-After"]) shedNoRetryAfter.add(1);
}

export default function () {
  const n = OFFSET + exec.scenario.iterationInTest;
  const token = `plink_lt_${RUN}_${n}`;
  const started = Date.now();

  const view = http.get(`${BASE}/v1/payment-links/${token}`, { tags: { step: "view" }, timeout: "30s" });
  if (view.status === 503 || view.status === 429) return recordShed(view);
  if (view.status !== 200) {
    wrong.add(1, { step: "view", status: String(view.status) });
    console.warn(`view ${token} -> ${view.status}`);
    return;
  }

  const res = http.post(`${BASE}/v1/payment-links/${token}/pay`, JSON.stringify({ card }), {
    headers: { "Content-Type": "application/json", "Idempotency-Key": uuid() },
    tags: { step: "pay" },
    timeout: "30s",
  });
  if (res.status === 503 || res.status === 429) return recordShed(res);
  if (res.status === 200) {
    const ok = check(res, { "paid with the link amount": (r) => r.json("status") === "paid" && r.json("amountFils") === 1500 });
    if (ok) {
      paid.add(1);
      checkoutTime.add(Date.now() - started);
    } else {
      wrong.add(1, { step: "pay", status: "200-bad-body" });
    }
    return;
  }
  // The simulator declines / errors ~2% of authorizations and captures on purpose.
  if (res.status === 402 || res.status === 502) {
    declined.add(1);
    return;
  }
  wrong.add(1, { step: "pay", status: String(res.status) });
  console.warn(`pay ${token} -> ${res.status} ${res.body}`);
}
