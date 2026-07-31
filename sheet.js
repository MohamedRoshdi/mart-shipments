// Reading a spreadsheet the shop exported. Shared by the manager page (catalog + stock sheets)
// and the admin page (the supplier list) — one place that knows how Excel writes Arabic.

/* The shop's own system exports its own column order — the catalog comes out as
   «كود الصنف | الوحدة | اسم الصنف | معامل التحويل | اخر سعر بيع» and the stock sheet as
   «الرصيد | كود الصنف | الوحدة | اسم الصنف». Reading the header row is what makes the order stop
   mattering, so nobody has to re-arrange a spreadsheet before importing it. A file with no header
   still works: the caller falls back to its old positional rules. */

const HEADERS = [
  ["barcode", /^(الباركود|باركود|كود الصنف|كود|الكود)$/],
  ["name", /^(اسم الصنف|الاسم|الصنف|اسم)$/],
  ["unit", /^(الوحدة|الوحده|وحدة|وحده)$/],
  ["qty", /^(الرصيد|الكمية|الكميه|كمية النظام|المخزون|رصيد)$/],
  ["price", /^(اخر سعر بيع|آخر سعر بيع|سعر البيع|السعر|سعر)$/],
];

export const clean = (c) => String(c == null ? "" : c).trim().replace(/^﻿/, "");

// null when the first row is data, not headings — one lucky word is not a header row
export function headerMap(cells) {
  const map = {};
  (cells || []).forEach((c, i) => {
    const t = clean(c);
    for (const [key, re] of HEADERS) if (map[key] === undefined && re.test(t)) map[key] = i;
  });
  return map.barcode !== undefined && map.name !== undefined ? map : null;
}

// the unit arrives as the code in the shop's system, not as a word
export const UNIT_NAMES = { 1: "قطعة", 2: "كيلو", 3: "علبة", 4: "كرتونة", 5: "عرض" };

export function unitName(v) {
  const t = clean(v);
  if (!t) return "";
  return /^\d+$/.test(t) ? (UNIT_NAMES[+t] || "") : t;
}

export async function sheetRows(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  // Excel on Arabic Windows exports windows-1256; a UTF-8 decode of that yields replacement chars
  if (text.includes("�")) text = new TextDecoder("windows-1256").decode(buf);
  return text.split(/\r?\n/).map((l) => l.split(/[,;\t]/));
}
