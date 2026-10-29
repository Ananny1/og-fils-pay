/**
 * BUG-050: the AI instruction files (CLAUDE.md, AGENTS.md, .cursorrules) are
 * loaded automatically by coding agents. The originals told agents to keep
 * the bugs ("cents", "UTC midnight", "Math.random is fine for OTPs", "never
 * modify tests"). This guards against those rules coming back.
 *
 * AGENT_FILES_ROOT points the check at another copy (e.g. the originals from
 * `git show aaccd16:<file>`); by default it reads the repo root.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = process.env.AGENT_FILES_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_FILES = ["CLAUDE.md", "AGENTS.md", ".cursorrules"];

/** Rules from the original files that contradict ADR-0001/0002, HANDOVER or security basics. */
const POISONED_RULES: Array<[string, RegExp]> = [
  ["money in cents / 1 BD = 100", /1 BD = 100\b|integer cents|uses cents|amounts in cents/i],
  ["UTC settlement day", /UTC midnight boundaries|windows use \*\*UTC midnight|windows are UTC-based/i],
  ["Math.random for OTPs", /Math\.random(\(\))?`? is (acceptable|fine|used deliberately)/i],
  ["tests may never change", /Never modify (existing )?test files|tests are regression-locked|If a test fails after your change/i],
  ["money package frozen", /DO NOT MODIFY|Frozen after Q2 audit|without explicit finance sign-off/],
  ["impersonation as owner", /super_admin\s*->\s*owner/],
  ["handler needn't check ownership", /middleware is authoritative/i],
  ["leave refunds unfinished", /Do not "fix" the 501|intentionally absent from `?WEBHOOK_ELIGIBLE_EVENT_TYPES/i],
  ["float32 is fine", /float32 in batch\.go is intentional|uses `float32` for display-only/i],
];

const REQUIRED_RULES: Array<[string, RegExp]> = [
  ["1 BD = 1000 fils", /1 BD = 1000 fils/],
  ["Bahrain business day", /Asia\/Bahrain/],
  ["never push", /never push/i],
];

for (const file of AGENT_FILES) {
  const text = readFileSync(join(root, file), "utf8");

  test(`${file} contains none of the poisoned rules`, () => {
    const found = POISONED_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
    assert.deepEqual(found, [], `${file} still tells agents: ${found.join(", ")}`);
  });

  test(`${file} states the real rules`, () => {
    const missing = REQUIRED_RULES.filter(([, pattern]) => !pattern.test(text)).map(([name]) => name);
    assert.deepEqual(missing, [], `${file} is missing: ${missing.join(", ")}`);
  });
}

test("agents are blocked from pushing (.claude/settings.json)", () => {
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")) as {
    permissions?: { deny?: string[] };
  };
  assert.ok(settings.permissions?.deny?.includes("Bash(git push:*)"));
});
