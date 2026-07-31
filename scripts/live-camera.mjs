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
await page.waitForTimeout(2500);                 // the stored settings decide which screen opens
if (await page.locator("#screen-login:not([hidden])").count()) {
  await page.fill("#login-pin", "1994");         // users exist on production: one PIN box for everyone
  await page.click("#btn-login");
} else if (await page.locator("#screen-name:not([hidden])").count()) {
  await page.fill("#employee-name", "فحص كاميرا");
  await page.press("#employee-name", "Enter");
}
await page.waitForSelector("#screen-home:not([hidden])", { timeout: 20000 });

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
await page.tap('#res-picker button[data-res="auto"]');       // whatever the browser hands out
log("3. saved settings:", JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem("camSettings")))));

/* ---- the scanner actually opens that camera, at the resolution that was asked for ---- */
await page.goBack();
await page.waitForSelector("#screen-home:not([hidden])");
await page.tap("#btn-new");
await page.tap("#btn-scan");
await page.waitForSelector("#reader video", { timeout: 20000 });
await page.waitForTimeout(2500);
log("4. video running on the browser default:", JSON.stringify(await videoState()));
log("5. resolution readout:", await page.locator("#cam-res").innerText());
await page.screenshot({ path: `${OUT}/cam-2-scanning.png` });

// the setting has to reach the stream, otherwise a small barcode stays unreadable
await page.tap("#btn-scan");                                 // stop
await page.tap("#btn-cam");
await page.waitForSelector("#screen-cam:not([hidden])");
await page.tap('#res-picker button[data-res="fhd"]');
await page.goBack();
await page.waitForSelector("#screen-new:not([hidden])");
await page.tap("#btn-scan");
await page.waitForSelector("#reader video", { timeout: 20000 });
await page.waitForTimeout(2500);
log("6. video running on «أعلى»:", JSON.stringify(await videoState()), "| readout:", await page.locator("#cam-res").innerText());

/* ---- leaving the screen releases the camera ---- */
await page.tap("#btn-cam");
await page.waitForSelector("#screen-cam:not([hidden])");
log("7. camera released on leaving:", (await liveTracks()) === 0, "| reader hidden:", await page.locator("#reader").isHidden());

/* ---- a saved camera that no longer exists falls back instead of dying ---- */
await page.evaluate(() => localStorage.setItem("camSettings", JSON.stringify({ deviceId: "ghost-camera", box: "med", torch: false, zoom: 1, res: "hd", focus: true })));
await page.goBack();                                    // back from the settings lands on the shipment screen
await page.waitForSelector("#screen-new:not([hidden])");
await page.tap("#btn-scan");
await page.waitForSelector("#reader video", { timeout: 20000 });
await page.waitForTimeout(1500);
log("8. fallback toast:", await page.locator("#toast").innerText());
log("9. scanning anyway:", JSON.stringify(await videoState()),
  "| saved id reset:", await page.evaluate(() => JSON.parse(localStorage.getItem("camSettings")).deviceId) === "");

await browser.close();
