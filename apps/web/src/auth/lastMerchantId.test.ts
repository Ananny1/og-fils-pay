import assert from "node:assert/strict";
import { test } from "node:test";

// A minimal localStorage so the helpers can run under node:test.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const { clearLastMerchantId, readLastMerchantId, writeLastMerchantId } = await import("./lastMerchantId.js");

test("signing out forgets the remembered merchant ID", () => {
  writeLastMerchantId("ce668d19-d805-469d-bc7e-d3b1741a6f16");
  assert.equal(readLastMerchantId(), "ce668d19-d805-469d-bc7e-d3b1741a6f16");
  clearLastMerchantId();
  assert.equal(readLastMerchantId(), "");
});
