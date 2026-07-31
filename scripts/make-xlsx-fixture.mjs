// Builds tests/fixtures/catalog.xlsx — a real, Excel-openable workbook in the column order the
// shop's own system exports. Deflate-compressed on purpose: that is the path sheet.js has to
// inflate through DecompressionStream, and a stored-only zip would never exercise it.
// node scripts/make-xlsx-fixture.mjs
import { deflateRawSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const enc = (s) => Buffer.from(s, "utf8");

function zip(files) {
  const parts = [], dir = [];
  let at = 0;
  for (const [name, text] of files) {
    const nm = enc(name), raw = enc(text), body = deflateRawSync(raw), sum = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);            // version needed
    head.writeUInt16LE(0x0800, 6);        // UTF-8 names
    head.writeUInt16LE(8, 8);             // deflate
    head.writeUInt32LE(sum, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nm.length, 26);
    parts.push(head, nm, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(sum, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nm.length, 28);
    cen.writeUInt32LE(at, 42);            // where the local header sits
    dir.push(cen, nm);
    at += 30 + nm.length + body.length;
  }
  const central = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, central, end]);
}

// every string Excel writes goes through the shared table; numbers stay inline
const strings = [
  "كود الصنف", "الوحدة", "اسم الصنف", "معامل التحويل", "اخر سعر بيع",
  "لبن جهينة كامل الدسم", "جبنة بيضاء فيتا", "6221024150011", "صنف بوحدة مجهولة",
];
const S = (s) => strings.indexOf(s);

// row 3 keeps its barcode as text and row 2 as a number — a real export has both, and the number
// is the one that used to break. Row 4 carries unit code 9, which the unit table does not know.
const rows = [
  ["s:كود الصنف", "s:الوحدة", "s:اسم الصنف", "s:معامل التحويل", "s:اخر سعر بيع"],
  ["6221031492105", "4", "s:لبن جهينة كامل الدسم", "12", "45.5"],
  ["s:6221024150011", "2", "s:جبنة بيضاء فيتا", "1", "88"],
  ["6221999000019", "9", "s:صنف بوحدة مجهولة", "1", "10"],
];

const col = (i) => String.fromCharCode(65 + i);
const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
  rows.map((r, ri) => `<row r="${ri + 1}">${
    r.map((c, ci) => (c.startsWith("s:")
      ? `<c r="${col(ci)}${ri + 1}" t="s"><v>${S(c.slice(2))}</v></c>`
      : `<c r="${col(ci)}${ri + 1}"><v>${c}</v></c>`)).join("")
  }</row>`).join("")
}</sheetData></worksheet>`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const files = [
  ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
  ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
  ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الأصناف" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
  ["xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${
    strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`],
  ["xl/worksheets/sheet1.xml", sheet],
];

mkdirSync("tests/fixtures", { recursive: true });
writeFileSync("tests/fixtures/catalog.xlsx", zip(files));
console.log("tests/fixtures/catalog.xlsx written:", rows.length - 1, "data rows");
