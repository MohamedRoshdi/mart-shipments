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
  // «الكمية في النظام» is the shipped template's heading and «الكمية في فرع قويسنا» is what the
  // catalog export writes — the file that comes out has to be the file that goes back in
  ["qty", /^(الرصيد|رصيد|المخزون|كمية النظام|الكمية|الكميه)( في .+)?$/],
  ["price", /^(اخر سعر بيع|آخر سعر بيع|سعر البيع|السعر|سعر)$/],
  // how many of the small unit are in the big one. Carried and shown, never multiplied by.
  ["factor", /^(معامل التحويل|معامل تحويل|المعامل|معامل)$/],
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

/* "" = the sheet said nothing, null = it gave a code the table has never heard of. The two have
   to be told apart: a missing column leaves the unit alone, an unknown code is a bad row and the
   importer refuses it rather than saving a product with no unit and saying nothing. */
export function unitName(v) {
  const t = clean(v);
  if (!t) return "";
  return /^\d+$/.test(t) ? (UNIT_NAMES[+t] || null) : t;
}

/* ---------- .xlsx ----------
   An .xlsx is a zip of XML files. Reading one here keeps the no-build rule: the zip directory is
   a few lines of DataView and the browser inflates the entries itself through DecompressionStream,
   so nothing has to be installed. Only what a shop export actually contains is parsed — the shared
   string table and the first worksheet. */

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

const isZip = (buf) => buf.byteLength > 4 && u32(new DataView(buf), 0) === 0x04034b50;

// name -> { method, bytes }, straight from the central directory
function zipEntries(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  const floor = Math.max(0, buf.byteLength - 65558);      // 64 KB comment + the record itself
  for (let i = buf.byteLength - 22; i >= floor; i--) if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const out = {};
  let p = u32(v, eocd + 16);
  for (let i = u16(v, eocd + 10); i > 0; i--) {
    if (p + 46 > buf.byteLength || u32(v, p) !== 0x02014b50) break;
    const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), cmtLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    // the local header repeats the name and carries its own extra field, hence the second read
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    out[name] = { method: u16(v, p + 10), bytes: new Uint8Array(buf, start, u32(v, p + 20)) };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

async function entryText(e) {
  if (!e) return "";
  if (e.method === 0) return new TextDecoder().decode(e.bytes);      // stored, nothing to inflate
  const stream = new Blob([e.bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unent = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, k) =>
  k[0] !== "#" ? ENT[k]
    : String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : +k.slice(1)));

// a cell's text can arrive in several runs (<r><t>…), so every <t> in it belongs to the value
const textOf = (xml) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unent(m[1])).join("");

// "BD7" -> 55: the column letters are base-26, and they are what keeps blank cells in place
function colOf(ref) {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetCells(xml, shared) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const cells = [];
    for (const m of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const body = m[2] || "";
      const i = colOf((m[1].match(/r="([A-Z]+)/) || [, "A"])[1]);
      const type = (m[1].match(/t="([^"]*)"/) || [, ""])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [, ""])[1];
      while (cells.length <= i) cells.push("");
      cells[i] = type === "s" ? (shared[+v] || "") : type === "inlineStr" ? textOf(body) : unent(v);
    }
    return cells;
  });
}

async function xlsxRows(zip) {
  const shared = [...(await entryText(zip["xl/sharedStrings.xml"]))
    .matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const first = Object.keys(zip).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];      // sheet2 before sheet10
  return first ? sheetCells(await entryText(zip[first]), shared) : [];
}

/* Rows out of whatever the shop uploaded. Throws in Arabic when the file is not a spreadsheet at
   all — every caller used to get an empty list instead, which reads on screen as «0 صنف». */
export async function sheetRows(file) {
  const buf = await file.arrayBuffer();
  if (isZip(buf)) {
    const zip = zipEntries(buf);
    const rows = zip && zip["xl/workbook.xml"] ? await xlsxRows(zip) : null;
    if (!rows) throw new Error("الملف ده مش ملف Excel — احفظه بصيغة xlsx أو CSV");
    return rows;
  }
  // the old .xls is a binary compound file, not text: decoding it as CSV produces junk rows
  if (buf.byteLength > 8 && u32(new DataView(buf), 0) === 0xe011cfd0)
    throw new Error("صيغة xls القديمة مش مدعومة — افتح الملف واحفظه Save As بصيغة xlsx");
  let text = new TextDecoder("utf-8").decode(buf);
  // Excel on Arabic Windows exports windows-1256; a UTF-8 decode of that yields replacement chars
  if (text.includes("�")) text = new TextDecoder("windows-1256").decode(buf);
  return text.split(/\r?\n/).map((l) => l.split(/[,;\t]/));
}
