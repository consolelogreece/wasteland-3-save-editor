// Runs the unit tests and the end-to-end tests in headless Chromium.
//
//   npm test                         run everything
//   npm test -- --save path/to.xml   also round-trip one of your own saves
//   npm test -- --headed             watch it run
//
// Other sites are blocked, so the CDN scripts don't load and the fallbacks are used.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { endToEnd } from "./e2e.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const savePath = args.includes("--save") ? args[args.indexOf("--save") + 1] : null;
if (args.includes("--save") && (!savePath || savePath.startsWith("--") || !fs.existsSync(savePath))) {
  console.error("--save needs the path of a save file that exists");
  process.exit(1);
}
const headed = args.includes("--headed");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: !headed });
let failures = 0;
const line = (ok, name, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${extra ? "\n        " + extra : ""}`);
};

async function newPage() {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await context.route(url => !url.href.startsWith(base), r => r.abort());
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  return page;
}

try {
  console.log("Unit tests");
  const unit = await newPage();
  await unit.goto(base + "/tests/index.html");
  await unit.waitForFunction(() => window.testResults, null, { timeout: 60000 });
  const results = await unit.evaluate(() => window.testResults);
  const loadErrors = await unit.evaluate(() => window.loadErrors);
  for (const e of loadErrors) line(false, "script failed to load", e);
  if (results.length < 50) line(false, "too few unit tests ran", `only ${results.length}; a test file probably didn't load`);
  for (const r of results) if (!r.ok) line(false, `${r.suite}: ${r.name}`, r.error + (r.stack ? "\n" + r.stack : ""));
  console.log(`  ${results.filter(r => r.ok).length} of ${results.length} passed`);
  for (const e of unit.errors) line(false, "page error", e);

  console.log("\nEnd-to-end tests");
  for (const [name, test] of endToEnd({ savePath })) {
    const page = await newPage();
    try {
      await page.goto(base + "/index.html");
      await test(page, base);
      if (page.errors.length) throw new Error("page errors: " + page.errors.join("; "));
      line(true, name);
    } catch (e) {
      line(false, name, e.message.split("\n")[0]);
    } finally {
      await page.context().close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} failure(s)` : "\nAll good");
process.exit(failures ? 1 : 0);
