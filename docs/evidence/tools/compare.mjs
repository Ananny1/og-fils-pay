const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
import fs from "node:fs";
const dir = process.env.SHOTS, out = `${dir}/compare`; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 2000, height: 700 } });
for (const name of fs.readdirSync(`${dir}/before`).map((f) => f.replace(".png", ""))) {
  const img = (k) => "data:image/png;base64," + fs.readFileSync(`${dir}/${k}/${name}.png`).toString("base64");
  await p.setContent(`<body style="margin:0;background:#1e1e1e;font:600 15px monospace;color:#f4f1ea">
    <div style="display:flex;gap:16px;padding:16px">
      ${["before","after"].map(k=>`<div style="flex:1"><div style="padding:0 0 8px;letter-spacing:.15em;color:${k==="after"?"#ff5a6e":"#aaa"}">${k.toUpperCase()} · ${name}</div><img src="${img(k)}" style="width:100%;border:1px solid #444"></div>`).join("")}
    </div></body>`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
await b.close(); console.log("ok", out);
