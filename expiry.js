// الصلاحيات — the pure part, shared by the employee screen and the manager tab.
// A month is never a stored thing: it exists while a row carries that date and disappears
// with the last row, so the screen can never fill up with empty months.

export const MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

const pad = (n) => String(n).padStart(2, "0");

export const monthLabel = (year, month) => `${MONTH_NAMES[month - 1] || month} ${year}`;
export const monthKey = (e) => `${e.year}-${pad(e.month)}`;

// what <input type="date"> reads and writes
export const isoOf = (e) => `${e.year}-${pad(e.month)}-${pad(e.day || 1)}`;
export function fromIso(s) {
  const [year, month, day] = String(s).split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// whole days from today to the expiry date; negative once it has passed
export const daysLeft = (e, now = new Date()) =>
  Math.round((midnight(new Date(e.year, e.month - 1, e.day || 1)) - midnight(now)) / 86400000);

// the four states the owner asked for, nearest first
export function statusOf(days) {
  if (days < 0) return "expired";
  if (days < 30) return "soon";
  if (days < 90) return "near";
  return "ok";
}

export const STATUS_LABEL = {
  expired: "انتهت الصلاحية",
  soon: "أقل من شهر",
  near: "أقل من ٣ شهور",
  ok: "لسه بدري",
};

export const daysWord = (d) => (d < 0 ? `فاتت بـ ${-d} يوم` : (d === 0 ? "بتنتهي النهاردة" : `فاضل ${d} يوم`));

// rows → months, nearest expiry on top; each month carries its own counters and colour
export function months(rows, now = new Date()) {
  const map = new Map();
  for (const e of rows) {
    if (!e || !e.year || !e.month) continue;
    const key = monthKey(e);
    const m = map.get(key) || { key, year: e.year, month: e.month, label: monthLabel(e.year, e.month), count: 0, qty: 0, items: [] };
    m.count += 1;
    m.qty += Number(e.qty) || 0;
    m.items.push(e);
    map.set(key, m);
  }
  return [...map.values()]
    .map((m) => {
      m.items.sort((a, b) => (a.day || 1) - (b.day || 1) || String(a.name).localeCompare(String(b.name), "ar"));
      m.days = Math.min(...m.items.map((e) => daysLeft(e, now)));   // the month is as urgent as its nearest row
      m.status = statusOf(m.days);
      return m;
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

// name or barcode, anywhere in the text — a month holds few enough rows for that to be free
export function search(rows, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((e) => String(e.name || "").toLowerCase().includes(s) || String(e.barcode || "").includes(s));
}
