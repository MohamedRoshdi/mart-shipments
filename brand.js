// الشعار فوق كل صفحة وفي أيقونة التبويب — from the logo the admin uploaded for the label.
// One image, stored once in config/app.label.logo (a data URL, already shrunk to 360px on
// upload because every page reads that doc at boot). No logo in the config = nothing changes:
// the pages look exactly as they did before this file existed.

export function applyBrand(cfg) {
  const logo = cfg && cfg.label && typeof cfg.label.logo === "string" ? cfg.label.logo : "";
  if (!logo) return;

  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.append(icon);
  }
  icon.href = logo;

  const bar = document.querySelector(".appbar");
  if (!bar) return;
  let img = bar.querySelector(".brand");
  if (!img) {
    img = document.createElement("img");
    img.className = "brand";
    img.alt = "";                       // decorative: the h1 beside it already names the screen
    bar.querySelector("h1")?.before(img);
  }
  img.src = logo;                       // a re-merge with a NEW logo updates in place
}
