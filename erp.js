// ما يتركه نظام المحل (PowerTech) بعد ما يستورد ملف TXT — the pure part of «تم الاستيراد».
//
// Measured from a real pulled file, never guessed (store 1_4552.txt, 2026-08-01):
//
//   6223001930518 \t 70.00000 \t \t \t 1 \t CRLF
//
// Six tab-separated fields per row: barcode, the quantity rewritten to five decimals, two empty
// fields, the success flag «1», and a trailing empty field. The flag sits in the FIFTH field of
// every row — «علامة النجاح (1) في نهاية كل السجلات». The file the app writes is two fields
// (barcode TAB qty), so an unimported file can never read as imported.
//
// Nothing here touches db, DOM or files — same rule as label.js. The caller decides which file
// to read and what to do with the answer; this module only says what the bytes mean.

/** The rows of a pulled file: [{ barcode, qty, flag }]. Empty rows are skipped. */
export function pulledRows(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const f = l.split("\t");
      return { barcode: f[0].trim(), qty: parseFloat(f[1]), flag: (f[4] || "").trim() };
    });
}

/** True only when the ERP has marked EVERY record imported. One unflagged row = not imported:
    a half-taken permit must never show «تم الاستيراد». */
export function isImported(text) {
  const rows = pulledRows(text);
  return rows.length > 0 && rows.every((r) => r.flag === "1");
}

/** The permit number the ERP put in its own file name (store 1_4552.txt → "4552").
    "" when the name carries none — the number is the ERP's, never invented here. */
export function permitOf(name) {
  const m = /_(\d+)\.txt$/i.exec(String(name || "").trim());
  return m ? m[1] : "";
}

/** Do the pulled rows describe this shipment's goods? Same barcodes, same quantities, nothing
    more and nothing less — the ERP renames the file, so the CONTENT is the only identity. */
export function sameGoods(rows, items) {
  const key = (b, q) => `${String(b).trim()}:${+q}`;
  const a = rows.map((r) => key(r.barcode, r.qty)).sort();
  const b = (items || []).map((i) => key(i.barcode, i.qty)).sort();
  return a.length > 0 && a.length === b.length && a.every((v, i) => v === b[i]);
}
