// ليبل الرف, on screen and on paper.
//
// The screenshots show the screen; the PDF is the real check — Chromium prints the page with
// preferCSSPageSize, so the /MediaBox in the file is the paper the label actually asks for.
// A label that looks right on screen and prints on A4 by mistake would pass every other test.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { signIn } from "./seed.mjs";

const OUT = process.env.OUT || "/tmp/shots";
const BASE = process.env.BASE || "http://localhost:8080";
const MM = 72 / 25.4;                       // PDF points per millimetre
const near = (a, b) => Math.abs(a - b) < 1.5;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

// a real EAN-13 (the checksum adds up) so the printed bars are a retail barcode, not Code 128
const BARCODE = "6223001234562";

await page.goto(`${BASE}/?test=1`);
await signIn(page);
await page.evaluate((code) => {
  localStorage.setItem("employeeName", "أحمد");
  localStorage.setItem("employeeBranch", "فرع قويسنا");
  localStorage.setItem("test-products", JSON.stringify({ [code]: "زيت عافية دوار الشمس 700 مل" }));
}, BARCODE);
await page.reload();
await page.waitForTimeout(400);
await shot("l1-home");

await page.click("#btn-label");
await page.waitForTimeout(200);
await shot("l2-empty");

await page.fill("#barcode-input", BARCODE);
await page.click("#btn-lookup");
await page.waitForTimeout(300);
await shot("l3-preview");

await page.fill("#label-price", "45.95");
await page.fill("#label-copies", "3");
await page.waitForTimeout(200);
await shot("l4-price");

// print with the dialog stubbed out, then ask Chromium for the same pages on paper
await page.evaluate(() => { window.print = () => {}; });
await page.click("#btn-print-label");
await page.waitForTimeout(200);
const pdf = `${OUT}/label.pdf`;
await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });

const boxes = [...readFileSync(pdf, "latin1").matchAll(/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/g)]
  .map((m) => [+m[1], +m[2]]);
const sized = boxes.filter(([w, h]) => near(w, 66 * MM) && near(h, 35 * MM));
console.log(`pages: ${boxes.length}`, boxes.map(([w, h]) => `${(w / MM).toFixed(1)}×${(h / MM).toFixed(1)}mm`).join(" · "));
console.log(sized.length === 3 && boxes.length === 3
  ? "OK — 3 نسخ، كل واحدة في صفحة 66×35 مم"
  : "FAIL — الطباعة مش طالعة بمقاس الليبل");

await browser.close();
process.exit(boxes.length === 3 && sized.length === 3 ? 0 : 1);
