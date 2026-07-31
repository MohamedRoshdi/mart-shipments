// Who is signed in and what they may do. Shared by all three pages so the permission
// list exists in exactly one place. These are UI gates, not security — Firestore has no
// auth and the rules only validate shape (see CLAUDE.md).

export const PERMS = [
  { id: "emp", label: "شاشة الموظف" },
  { id: "mgr", label: "شاشة المدير" },
  { id: "adm", label: "شاشة النظام" },
  { id: "create", label: "إنشاء شحنة" },
  { id: "count", label: "الجرد" },
  { id: "expiry", label: "الصلاحيات" },
  { id: "edit", label: "تعديل الشحنات" },
  { id: "del", label: "حذف الشحنات" },
  { id: "download", label: "تحميل الملفات" },
  { id: "products", label: "إدارة الأصناف" },
  { id: "import", label: "استيراد الأصناف" },
  { id: "danger", label: "الأدوات الخطرة" },
];

export const ALL_PERMS = PERMS.map((p) => p.id);
export const SCREEN_PERMS = ["emp", "mgr", "adm"];

const KEY = "session";
const MAX_AGE = 12 * 60 * 60 * 1000;   // one shift; after that the PIN is asked again
const DEV_KEY = "deviceId";

// One id per phone, written once and kept. A user account sticks to the first phone that
// signs in with it, so a shared PIN cannot travel to a second phone until the admin frees it.
export function deviceId() {
  let id = localStorage.getItem(DEV_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `d${Date.now()}${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEV_KEY, id);
  }
  return id;
}

export function session() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { console.error(e); }
  if (!s || !Array.isArray(s.perms) || Date.now() - s.at > MAX_AGE) {
    if (s) localStorage.removeItem(KEY);
    return null;
  }
  s.branches = branchesOf(s);          // a session written before multi-branch had one string
  return s;
}

// a user may cover more than one branch; an empty list means every branch
export const branchesOf = (u) => (Array.isArray(u.branches) ? u.branches : (u.branch ? [u.branch] : []));

// isUser marks a real account from the admin's users list, as opposed to one of the legacy
// PINs — only a named account may put its own name on shipments without being asked
export function startSession(name, branches, perms, isUser) {
  localStorage.setItem(KEY, JSON.stringify({ name, branches: branches || [], perms, user: !!isUser, at: Date.now() }));
}

export const endSession = () => localStorage.removeItem(KEY);

export function can(perm) {
  const s = session();
  return !!s && s.perms.includes(perm);
}

// PIN → identity. Users the admin created win; the PINs shipped in the code and the branch
// PINs keep working, so a wrong users list can never lock the shop out of its own data.
export function authenticate(pin, cfg, codeAdminPin) {
  const user = (cfg.users || []).find((u) => u.pin === pin);
  if (user) {
    const dev = deviceId();
    // bound to another phone → refused here; only the admin may unbind it
    if (user.device && user.device !== dev) return { blocked: true, name: user.name, branches: [], perms: [] };
    return {
      name: user.name, branches: branchesOf(user), perms: (user.perms || []).slice(), user: true,
      claim: user.device ? null : dev,     // first phone to use this account claims it
    };
  }
  if (pin && (pin === cfg.adminPin || pin === codeAdminPin)) {
    return { name: "الأدمن", branches: [], perms: ALL_PERMS.slice() };
  }
  if (pin && pin === cfg.managerPin) {
    return { name: "المدير العام", branches: [], perms: ALL_PERMS.filter((p) => p !== "adm") };
  }
  const branch = (cfg.branches || []).find((b) => b.pin === pin);
  if (branch) {
    return { name: `مدير ${branch.name}`, branches: [branch.name], perms: ALL_PERMS.filter((p) => p !== "adm"), branchPin: true };
  }
  return null;
}

// keep the query string across pages, otherwise ?test=1 (and anything after it) is lost
export const withQuery = (page) => page + location.search;
export const goTo = (page) => { location.href = withQuery(page); };

// where a set of permissions is allowed to land, most specific screen first
export function landingPage(perms) {
  if (perms.includes("emp")) return "index.html";
  if (perms.includes("mgr")) return "manager.html";
  if (perms.includes("adm")) return "admin.html";
  return null;
}
