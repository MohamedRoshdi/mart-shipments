// طباعة ليبل الرف — the barcode and the printed label, on their own.
//
// Deliberately independent of everything else: nothing here reads Firestore, the session or the
// DOM. It takes a product plus the shop's label settings and hands back HTML, so adding the price
// (or any other field) later is one line in labelHtml and nothing else moves.

/* ---------- settings: the shop's label, in millimetres ---------- */

// 66 × 35 mm is the sheet the shop already buys (A4 210 × 297, label 66.0 × 35.0)
export const DEFAULTS = { w: 66, h: 35, sheet: "label", logo: "" };

const num = (v, lo, hi, d) => (Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : d);

// never trusted: config/app is publicly writable, so a bad size must fall back, not print blank
export function labelCfg(cfg) {
  const l = (cfg && cfg.label) || {};
  return {
    w: num(l.w, 20, 210, DEFAULTS.w),
    h: num(l.h, 10, 297, DEFAULTS.h),
    sheet: l.sheet === "a4" ? "a4" : "label",       // a roll of labels, or labels on an A4 sheet
    logo: typeof l.logo === "string" ? l.logo : "",
  };
}

/* ---------- EAN-13 ---------- */

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011"];
const flip = (s) => s.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
const EAN_R = EAN_L.map(flip);
const EAN_G = EAN_R.map((s) => [...s].reverse().join(""));
// the first digit is not printed as bars — it picks which parity the six left digits use
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

// the 13th digit of a retail barcode is a checksum
export function eanCheck(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (+first12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

// A 13-digit code whose checksum does not add up is not an EAN-13, whatever it looks like —
// it falls through to Code 128 rather than printing a barcode the till would read as another
// product.
function ean13(code) {
  if (!/^\d{13}$/.test(code) || +code[12] !== eanCheck(code)) return null;
  const p = PARITY[+code[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (p[i - 1] === "L" ? EAN_L : EAN_G)[+code[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[+code[i]];
  return `${bits}101`;
}

/* ---------- Code 128 ---------- */

// bar/space widths per symbol; index 0–102 are the data values, 103–105 the three start codes
// and 106 the stop
const C128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

// widths alternate bar, space, bar … starting on a bar
function bitsOf(widths) {
  let bits = "";
  let bar = true;
  for (const w of widths) {
    bits += (bar ? "1" : "0").repeat(+w);
    bar = !bar;
  }
  return bits;
}

// Subset B carries any printable ASCII. An all-digit code of even length goes through subset C
// instead: two digits per symbol, so a 13-digit barcode prints half as wide and reads from
// further away.
function code128(code) {
  if (!/^[\x20-\x7e]+$/.test(code)) return null;
  const pairs = /^\d+$/.test(code) && code.length % 2 === 0;
  const start = pairs ? 105 : 104;
  const values = pairs
    ? code.match(/\d{2}/g).map(Number)
    : [...code].map((ch) => ch.charCodeAt(0) - 32);
  let sum = start;
  values.forEach((v, i) => { sum += v * (i + 1); });
  return [start, ...values, sum % 103, 106].map((v) => bitsOf(C128[v])).join("");
}

/* ---------- drawing ---------- */

const QUIET = 10;   // blank modules each side; a barcode printed edge-to-edge scans as nothing

// EAN-13 when the number really is one — that is what the till expects — otherwise Code 128,
// which takes any code the shop invents.
export function encode(code) {
  const s = String(code == null ? "" : code).trim();
  if (!s) return null;
  const e = ean13(s);
  if (e) return { bits: e, kind: "EAN-13" };
  const c = code128(s);
  return c ? { bits: c, kind: "CODE128" } : null;
}

// one <rect> per run of bars, in module units: the SVG stretches to whatever the label gives it
export function barcodeSvg(code) {
  const enc = encode(code);
  if (!enc) return "";
  const bits = enc.bits;
  let rects = "";
  for (let i = 0; i < bits.length;) {
    if (bits[i] === "0") { i++; continue; }
    let j = i;
    while (bits[j] === "1") j++;
    rects += `<rect x="${i + QUIET}" y="0" width="${j - i}" height="100"/>`;
    i = j;
  }
  // xmlns is not optional: without it the same SVG is fine inline and blank as an <img>
  return `<svg xmlns="http://www.w3.org/2000/svg" class="lbl-svg" viewBox="0 0 ${bits.length + QUIET * 2} 100"`
    + ` preserveAspectRatio="none" shape-rendering="crispEdges" role="img"`
    + ` aria-label="${esc(code)}">${rects}</svg>`;
}

/* ---------- the label ---------- */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// text and attributes both: product names and the logo URL are publicly writable
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// The five rows are always in the markup, so a label with no logo and no price still lines up.
// price is optional and unstored — the day the catalog carries one, pass it here and nothing
// else changes.
export function labelHtml(item, cfg) {
  const c = labelCfg(cfg);
  const price = String(item.price == null ? "" : item.price).trim();
  const bars = barcodeSvg(item.barcode);
  return `<div class="lbl" style="inline-size:${c.w}mm;block-size:${c.h}mm">`
    + (c.logo ? `<img class="lbl-logo" src="${esc(c.logo)}" alt="">` : `<span class="lbl-logo"></span>`)
    + `<div class="lbl-name">${esc(item.name)}</div>`
    + `<div class="lbl-bars">${bars || `<span class="lbl-plain">${esc(item.barcode)}</span>`}</div>`
    + `<div class="lbl-code">${esc(item.barcode)}</div>`
    + (price ? `<div class="lbl-price">${esc(price)} ج</div>` : `<span class="lbl-price"></span>`)
    + `</div>`;
}

export const sheetHtml = (items, cfg) => items.map((i) => labelHtml(i, cfg)).join("");
