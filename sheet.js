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
  ["unit", /^(الوحدة|الوحده|وحدة|وحده|كود الوحدة|كود الوحده)$/],
  // «الكمية في النظام» is the shipped template's heading and «الكمية في فرع قويسنا» is what the
  // catalog export writes — the file that comes out has to be the file that goes back in
  ["qty", /^(الرصيد|رصيد|المخزون|كمية النظام|الكمية|الكميه)( في .+)?$/],
  ["price", /^(اخر سعر بيع|آخر سعر بيع|سعر البيع|السعر|سعر)$/],
  // how many of the small unit are in the big one. Carried and shown, never multiplied by.
  ["factor", /^(معامل التحويل|معامل تحويل|المعامل|معامل)$/],
  // the supplier file is its own two columns, and its «كود» is not a product's
  ["supplierCode", /^(كود المورد|كود مورد)$/],
  ["supplierName", /^(اسم المورد|اسم مورد|المورد|مورد)$/],
];

// what a refusal calls the column, so the message names the heading the shop actually has to add
const LABELS = {
  barcode: "كود الصنف", name: "اسم الصنف", unit: "الوحدة", qty: "الرصيد",
  price: "اخر سعر بيع", factor: "معامل التحويل",
  supplierCode: "كود المورد", supplierName: "اسم المورد",
};

export const clean = (c) => String(c == null ? "" : c).trim().replace(/^﻿/, "");

// every heading this row carries, by column index
const scan = (cells) => {
  const map = {};
  (cells || []).forEach((c, i) => {
    const t = clean(c);
    for (const [key, re] of HEADERS) if (map[key] === undefined && re.test(t)) map[key] = i;
  });
  return map;
};

/* Two headings, not one: every file the shop exports has at least two, and one lucky word in a
   data row must not turn the first row of products into a header and swallow it. This is what
   tells «the file has no header, read it positionally» apart from «the file has a header and a
   column is missing», which is refused by name instead. */
export const looksLikeHeader = (cells) => Object.keys(scan(cells)).length >= 2;

// null when the row is not the headings this importer needs — the caller then falls back
export function headerMap(cells, need = ["barcode", "name"]) {
  const map = scan(cells);
  return need.every((k) => map[k] !== undefined) ? map : null;
}

// the headings the file is missing, already in Arabic, ready to put in front of the shop
export const missingColumns = (cells, need) => {
  const map = scan(cells);
  return need.filter((k) => map[k] === undefined).map((k) => LABELS[k] || k);
};

export const columnNames = (need) => need.map((k) => LABELS[k] || k);

/* A header row that is missing a column the import cannot do without stops the whole file, and
   says which column. Falling through to the positional rules instead is what quietly writes the
   wrong data under the right barcode — and nobody finds out until a shelf count disagrees. A file
   with no headings at all is not an error: that is the old shape, and it still reads positionally,
   which is why every sheet that used to import still does. */
export function requireColumns(rows, need) {
  const first = (rows || [])[0];
  if (!looksLikeHeader(first)) return null;
  const gone = missingColumns(first, need);
  if (gone.length) throw new Error(
    `الملف ناقصه عمود «${gone.join("» و«")}» — لازم يبقى فيه: ${columnNames(need).join("، ")}`);
  return headerMap(first, need);
}

// the unit arrives as the code in the shop's system, not as a word
export const UNIT_NAMES = { 1: "قطعة", 2: "كيلو", 3: "علبة", 4: "كرتونة", 5: "عرض" };

/* The ERP's own number, kept beside the word so what it sent can be sent back unchanged. Only a
   code the table knows comes back: a cell holding 9, or a word, has no code to keep, and storing
   an unknown number would be storing something nothing can read. */
export const unitCode = (v) => (UNIT_NAMES[clean(v)] ? Number(clean(v)) : null);

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

/* ---------- CSV ----------
   Excel quotes any cell holding the separator, and «شيبسي، ٣٠ جم» is a real product name. Splitting
   on the separator alone turns that one cell into two and shifts every column after it — which the
   old positional readers survived only by swallowing the middle cells. Once the columns come from
   the header row, a shifted row is a wrong import, so the fields are read properly. */

// Excel writes ; on an Arabic Windows locale, , elsewhere, and the shop's own dumps use tabs
const sepOf = (line) => [",", ";", "\t"]
  .map((s) => [s, line.split(s).length])
  .sort((a, b) => b[1] - a[1])[0][0];

function csvRows(text) {
  const sep = sepOf(text.split("\n", 1)[0] || "");
  const rows = [[]];
  let field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { field += ch; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }   // "" inside quotes is one quote
      quoted = false;
      continue;
    }
    if (ch === '"' && !field) { quoted = true; continue; }
    if (ch === sep) { rows[rows.length - 1].push(field); field = ""; continue; }
    if (ch === "\n") { rows[rows.length - 1].push(field); field = ""; rows.push([]); continue; }
    if (ch === "\r") continue;
    field += ch;
  }
  rows[rows.length - 1].push(field);
  // a file ending in a newline leaves one empty row behind
  if (rows.length > 1 && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
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
  return csvRows(text);
}
