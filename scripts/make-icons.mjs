import { chromium } from "@playwright/test";

const html = (s) => `<style>*{margin:0}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0a7d33"/>
  <text x="256" y="360" font-size="280" text-anchor="middle" fill="#fff" font-family="sans-serif">ش</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const s of [192, 512]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(html(s));
  await page.locator("svg").screenshot({ path: `icon-${s}.png` });
}
await browser.close();
console.log("icons written");
