// Reading a spreadsheet the shop exported. Shared by the manager page (catalog + stock sheets)
// and the admin page (the supplier list) — one place that knows how Excel writes Arabic.

export async function sheetRows(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  // Excel on Arabic Windows exports windows-1256; a UTF-8 decode of that yields replacement chars
  if (text.includes("�")) text = new TextDecoder("windows-1256").decode(buf);
  return text.split(/\r?\n/).map((l) => l.split(/[,;\t]/));
}
