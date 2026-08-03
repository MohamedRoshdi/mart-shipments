/* One door: since 2026-08-01 every page opens on the PIN screen unless `localStorage.session`
   holds a live one, so a headless run has to sign itself in the way a person does. Five of the
   screenshot scripts were still writing only `employeeName` — the key of the DELETED
   «بيانات الموظف» screen — and had been timing out on the PIN screen ever since (measured
   2026-08-03). Kept here rather than copied into each script so the next change to the session
   shape breaks in one place instead of five. */

// every permission the employee screens gate on; a screenshot run is never testing the gates
export const EMP_PERMS = ["emp", "create", "count", "expiry", "label", "edit", "download"];

export const sessionFor = (name = "أحمد", perms = EMP_PERMS, branches = []) =>
  ({ name, branches, perms, user: true, at: Date.now() });

// call right after the first goto, before the reload the script already does
export const signIn = (page, name, perms, branches) =>
  page.evaluate((s) => localStorage.setItem("session", JSON.stringify(s)),
    sessionFor(name, perms, branches));
