// Camera path under a synthetic video device: camera list, chosen camera, start/stop,
// and the fallback when a saved camera is gone. Real decoding still needs a real phone.
// BASE=http://localhost:8080 to run against a local server.
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE || "https://mohamedroshdi.github.io/mart-shipments";
const OUT = process.env.OUT || "/tmp/shots";
const log = (...a) => console.log("[camera]", ...a);

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const ctx = await browser.newContext({
  ...devices["Pixel 5"],
  locale: "ar-EG",
  permissions: ["camera"],
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const videoState = () => page.evaluate(() => {
  const v = document.querySelector("#reader video");
  return v ? { w: v.videoWidth, h: v.videoHeight, playing: !v.paused } : null;
});
const liveTracks = () => page.evaluate(() => performance.now() >= 0
  && [...document.querySelectorAll("#reader video")].length);

await page.goto(BASE + "/", { waitUntil: "load" });
const branch = await page.evaluate(() => window.APP_CONFIG.branches[0]);
await page.fill("#employee-name", "فحص كاميرا");
await page.fill("#branch-pin", branch.pin);
await page.press("#branch-pin", "Enter");
await page.waitForSelector("#screen-home:not([hidden])");

/* ---- the settings screen sees the camera ---- */
await page.tap("#btn-cam");
await page.waitForSelector("#screen-cam:not([hidden])");
await page.waitForTimeout(2500);
const cams = await page.locator("#cam-list button[data-cam]").allInnerTexts();
log("1. cameras offered:", JSON.stringify(cams), "| note:", await page.locator("#cam-note").innerText());
await page.screenshot({ path: `${OUT}/cam-1-settings.png` });

const ids = await page.locator("#cam-list button[data-cam]").evaluateAll(els => els.map(e => e.dataset.cam));
const pick = ids.find(Boolean);
await page.tap(`#cam-list button[data-cam="${pick}"]`);
log("2. picked a real camera id:", JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem("camSettings")))));

await page.tap('#box-picker button[data-box="large"]');
await page.fill("#cam-zoom", "2");
log("3. saved settings:", JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem("camSettings")))));

/* ---- the scanner actually opens that camera ---- */
await page.goBack();
await page.waitForSelector("#screen-home:not([hidden])");
await page.tap("#btn-new");
await page.tap("#btn-scan");
await page.waitForSelector("#reader video", { timeout: 20000 });
await page.waitForTimeout(2500);
log("4. video running:", JSON.stringify(await videoState()));
log("5. torch/zoom bar shown (fake device has no capabilities):", await page.locator("#cam-live").isVisible());
await page.screenshot({ path: `${OUT}/cam-2-scanning.png` });

/* ---- leaving the screen releases the camera ---- */
await page.tap("#btn-cam");
await page.waitForSelector("#screen-cam:not([hidden])");
log("6. camera released on leaving:", (await liveTracks()) === 0, "| reader hidden:", await page.locator("#reader").isHidden());

/* ---- a saved camera that no longer exists falls back instead of dying ---- */
await page.evaluate(() => localStorage.setItem("camSettings", JSON.stringify({ deviceId: "ghost-camera", box: "med", torch: false, zoom: 1 })));
await page.goBack();                                    // back from the settings lands on the shipment screen
await page.waitForSelector("#screen-new:not([hidden])");
await page.tap("#btn-scan");
await page.waitForSelector("#reader video", { timeout: 20000 });
await page.waitForTimeout(1500);
log("7. fallback toast:", await page.locator("#toast").innerText());
log("8. scanning anyway:", JSON.stringify(await videoState()),
  "| saved id reset:", await page.evaluate(() => JSON.parse(localStorage.getItem("camSettings")).deviceId) === "");

await browser.close();
