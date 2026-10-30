// usage: node shots.mjs <label>   — screenshots key screens of web + admin
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const label = process.argv[2] ?? "shot";
const out = `${process.env.SHOTS}/${label}`;
const fs = await import("node:fs"); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const W = "http://localhost:5173", A = "http://localhost:5174";
async function shot(page, name, full = false) { await page.waitForTimeout(1600); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); }

// --- merchant web (light theme forced for comparability) ---
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
await ctx.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch {} });
const p = await ctx.newPage();
await p.goto(`${W}/dashboard/login`); await shot(p, "web-login");
await p.fill("#login-merchant-id", "9972daab-2c86-459f-9d78-3fe1be4e3280");
await p.fill("#login-email", "owner@alpharetail.example");
await p.fill("#login-password", "FilsPaySeed!2026");
await p.click('button[type="submit"]');
await p.click('button:has-text("Use this code")'); await p.click('button[type="submit"]:has-text("Verify")');
await p.waitForURL(/transactions/);
await shot(p, "web-transactions");
await p.goto(`${W}/dashboard/settlement`); await shot(p, "web-payouts");
await p.goto(`${W}/dashboard/reconciliation`); await shot(p, "web-reconciliation");
await p.goto(`${W}/dashboard/overview`); await shot(p, "web-overview");
await p.goto(`${W}/pay/nonexistent-token`); await shot(p, "web-checkout-notfound");
// mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
await m.context().addCookies(await ctx.cookies());
await m.goto(`${W}/dashboard/settlement`); await shot(m, "web-mobile-payouts");

// --- admin ---
const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await a.goto(`${A}/login`); await shot(a, "admin-login");
await a.fill('input[type="email"]', "finance@filspay.test");
await a.fill('input[type="password"]', "FilsPayAdminSeed!2026");
await a.click('button[type="submit"]');
const code = (await a.locator("code").first().textContent({ timeout: 8000 }))?.trim();
await a.fill('input[type="text"]', code ?? "");
await a.click('button[type="submit"]');
await a.waitForURL(/merchants/, { timeout: 10000 });
await shot(a, "admin-merchants");
await a.click("table a >> nth=0").catch(() => {}); await shot(a, "admin-merchant-detail");
await a.goto(`${A}/settlement`); await shot(a, "admin-settlement");
await browser.close();
console.log("saved to", out);
