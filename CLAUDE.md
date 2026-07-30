# mart-shipments — working notes for Claude

Shipment-intake PWA for a two-branch Egyptian supermarket. Employees scan barcodes
into a shipment on their phones; a manager page reviews, edits, exports and manages
the product catalog; an admin page owns the settings, the audit trail and the
destructive tools. Arabic-only UI, RTL, offline-capable, free to run.

## Hard rules for this repo

1. **No framework, no bundler, no build step.** Plain ES modules served as files.
   npm exists only for Playwright. Never introduce a build.
2. **Arabic-only UI, clean Egyptian Arabic** (not stiff MSA). Every user-facing
   string lives in the HTML/JS as literal Arabic text. No i18n layer.
3. **Logical CSS properties only** (`margin-inline`, `inset-block-end`,
   `inline-size`, `border-start-start-radius`). Never `left`/`right`/`width` for
   layout. Barcodes, quantities and PINs get `dir="ltr"`.
4. **Every interpolation into HTML goes through `esc()`** — and through
   `escAttr()` when it lands inside an attribute (`value="…"`, `data-…="…"`).
   Both `shipments` and `products` are publicly writable, so all stored text is
   untrusted.
5. **`db.js` is the only file that knows where data lives.** `app.js` and
   `manager.js` never touch Firestore or localStorage keys directly.
6. **Bump `CACHE` in `sw.js` on every deploy.** Serving is cache-first, so phones
   keep the old bundle until the cache name changes. Currently `mart-v18`.
7. **Deploy = push to master.** GitHub Pages serves the repo root. Firestore rules
   deploy separately: `npx firebase deploy --only firestore:rules --project shipments-alaela-mart`.

## Layout

| File | Role |
|---|---|
| `index.html` / `app.js` | employee app: setup, home, new/edit shipment, camera, item sheet |
| `manager.html` / `manager.js` | manager app: PIN, shipment list, shipment edit, catalog screen, import/export |
| `admin.html` / `admin.js` | admin app: users + permissions, settings (branches, PINs, types), audit trail, bulk delete, catalog wipe |
| `auth.js` | permission list, PIN → identity, the 12-hour session shared by all three pages |
| `db.js` | data layer; `?test=1` switches the whole app to localStorage |
| `zip.js` | store-only ZIP writer, ~80 lines, no dependency; used by the folder export |
| `style.css` | one stylesheet for all three pages |
| `sw.js`, `manifest.json`, `manifest-manager.json`, `manifest-admin.json` | three installable PWAs (employee + manager + admin) |
| `firebase-config.js` | Firebase keys **plus** `APP_CONFIG`: PINs (incl. `adminPin`), branches, shipment types |
| `firestore.rules` | shape validation; the only server-side guard that exists |
| `SETUP.md` | Arabic guide for the shop owner |
| `tests/app.spec.js` | 37 Playwright tests, all in localStorage mode |
| `scripts/*.mjs` | live checks and screenshot helpers (see below) |

## Data model

`shipments/{auto}` — `name`, `createdBy`, `createdAt` (epoch ms), `branch`, `type`,
`items: [{barcode, name, qty}]`.

`products/{barcode}` — `{ name }`. The barcode **is** the document id.

`config/app` — `{ managerPin, adminPin, branches: [{name, pin}], shipmentTypes: [], users: [] }`.
Each user is `{ name, pin, branches: [], perms: [] }`; `perms` holds ids from `auth.js` `PERMS`
(`emp`/`mgr`/`adm` are screens, the rest are actions). **`branches: []` means every branch**, one
name means locked to it, several means the user works across them. `auth.branchesOf()` also reads
the old single `branch` string, so users saved before this still work.
The admin page writes it; every page merges it over `window.APP_CONFIG` at boot, so the
shipped `firebase-config.js` is only a fallback. A missing doc changes nothing.

`logs/{auto}` — `{ who, action, target, at }`. Append-only audit trail: manager and admin
mutations write a row, `update`/`delete` are denied by the rules.

Rules in force (all live-tested):
- `config`: only the doc id `app`, only those five keys, PINs ≤ 8 chars, lists ≤ 10, users ≤ 40.
- `logs`: create-only with the four keys; `update`/`delete` always denied.
- create: key allow-list, types, sizes, `items` ≤ 200.
- update: `name`, `items`, `type` may change; `createdBy`, `createdAt` and
  **`branch` are immutable** (403 on any attempt).
- delete: allowed on both collections (the owner asked for it).
- `products`: create/update/delete open, `name` 1–100 chars, barcode ≤ 32.

`createdAt` is `Date.now()` on purpose — `serverTimestamp()` reads back null in the
local cache and breaks the offline `orderBy('createdAt', 'desc')` list.

## Invariants that are easy to break

- **Only catalog barcodes may enter a shipment.** An unlisted barcode shows the
  refusal sheet (`#item-warn`), hides the qty stepper and the add button, and
  `btn-add-item` also refuses when called programmatically. Item names are never
  typed by employees — they come from `products` only.
- **`auth.js` owns identity for all three pages.** `authenticate(pin, cfg, codeAdminPin)` tries
  the admin's users first, then the legacy PINs (admin → every permission, manager → all but
  `adm`, branch PIN → that branch, flagged `branchPin` so the employee page still runs the old
  name+branch setup). The result goes into `localStorage.session` for 12 hours and every page
  reads it, so signing in once covers all three. **`canDo(perm)` returns true when there is no
  session at all** — that is what keeps the pre-users behaviour intact for a shop that never
  creates a user.
- **Branch scope is a list, never a single value.** `manager.js` keeps `scopes`: empty = every
  branch (filter chips show all), one = the chip is locked and the title becomes that branch,
  several = chips are `الكل` plus that subset. The employee page mirrors it with
  `allowedBranches()`: one branch prints a line of text, several render `#new-branch-picker` so
  the branch is chosen per shipment (`state.branch`, not `myBranch()`, is what gets saved).
- **`session.user` separates a real account from a legacy PIN.** Only a real account may be
  auto-enrolled as the employee (name written to `employeeName`); a legacy manager PIN must
  still type a name, which is what the old flow did.
- **Never write `location.href = "manager.html"`.** That drops the query string and silently
  takes the app out of `?test=1`, straight onto live Firestore. Use `auth.goTo()` /
  `auth.withQuery()`; the same applies to any `<a href>` between pages.
- **Camera preferences are per phone, in `localStorage.camSettings`** (`{deviceId, box, torch, zoom}`),
  never in Firestore — the whole point is that one shop phone needs a different lens than another.
  `startScan(retried)` falls back to `facingMode: environment` and clears the saved `deviceId`
  when `{deviceId:{exact}}` fails, so a swapped phone cannot leave the scanner dead.
  Torch and zoom go through `applyVideoConstraints({advanced:[…]})` and only appear when
  `getRunningTrackCapabilities()` reports them. `navTo` calls `stopScan()` for any screen other
  than `screen-new`, otherwise the camera keeps running behind the settings screen.
- **`window.APP_CONFIG` is mutated at boot, not read fresh.** `app.js` awaits the merge
  inside its boot IIFE; `manager.js` and `admin.js` paint the PIN screen first and make the
  PIN handler `await cfgReady`. Anything that reads branches/types before that merge sees
  the code defaults — that is why `state.branch` is recomputed after it.
- **`CODE_ADMIN_PIN` must stay.** `config/app` is publicly writable, so a wrong (or hostile)
  save could otherwise lock the owner out for good. The admin PIN in `firebase-config.js`
  always opens both the admin page and the manager's master view; captured at module load,
  before the merge overwrites `APP_CONFIG.adminPin`.
- **The ZIP is store-only on purpose.** Folder structure comes from `/` inside the entry
  names plus flag bit `0x0800` for UTF-8; a browser download cannot create folders itself
  (Chrome rewrites `/` in the file name). Verified with `python3 -c` + `zipfile.testzip()`.
- **Every `db.js` export awaits `live()`**, which resolves `initDb()`. Without it a
  call that lands before the Firebase SDK finishes throws on `fs` being null — this
  once made the catalog import silently save 0 rows.
- **`[hidden] { display: none !important }` in `style.css` must stay.** A class
  with `display: flex/grid` otherwise outranks the `hidden` attribute and the
  element stays visible.
- **Specificity traps:** `.row-actions button` overrides `.primary`; add explicit
  `.row-actions button.primary` when a row button must be amber.
- **The item sheet owns the screen while open** (scrim + `body.sheet-open` hides
  the bottom bar). Anything behind it is unclickable — dismiss with `#btn-cancel-item`.
- **Two ways in, both still live.** With users configured, the PIN alone identifies the
  person and the branch comes from their account. With no users (or a legacy branch PIN),
  the old flow stands: the branch is chosen once per phone against the branch PIN, and the
  employee types their name. Shipments always carry a branch and the manager can never move
  one between branches (the rules forbid it).
- **Manager scope filters before render**, never after: `openManager()` drops other branches
  out of `all`, so a scoped user's page never holds data they may not see.
- Catalog screen loads `PRODUCT_CAP = 300` rows; search is **server-side prefix**
  on name and on document id (50 hits each). Prefix, not substring. `countProducts()`
  gives the honest total. Export uses `listAllProducts()` — one deliberate full read.

## Commands

```bash
npx playwright test                 # 37 tests, localStorage mode, ~18s
npx playwright test -g "catalog"    # one group
python3 -m http.server 8080         # serve locally, then open /?test=1
node scripts/make-icons.mjs         # regenerate the PWA icons
```

Live checks against **production Firestore** (each cleans up after itself):

```bash
STAMP=$RANDOM node scripts/live-check.mjs        # employee → manager full loop
STAMP=$RANDOM node scripts/live-mobile.mjs       # Pixel 5, 3 contexts: admin makes a user, employee scans, manager checks
STAMP=$RANDOM node scripts/live-products.mjs     # catalog: import, rename, delete
node scripts/live-search-name.mjs                # proves search reaches past the loaded page
node scripts/live-admin.mjs                      # admin page, settings doc, audit trail, rule probes, ZIP
BASE=http://localhost:8087 node scripts/live-camera.mjs   # camera list/start/stop/fallback on a fake device
OUT=/tmp/shots node scripts/shots.mjs            # local screenshots (needs the server above)
```

Writing live scripts: pull real barcodes from the catalog first — invented ones are
refused by design. Never `waitUntil: "networkidle"`; Firestore keeps a socket open,
so it never fires. A helper that reads the search results must wait out the 250 ms
debounce, or it reports false negatives.

## Testing notes

- Tests run with `?test=1`; `db.js` then uses `test-shipments` / `test-products` in
  localStorage. Seed `test-products` in any test that adds items, or the add is
  refused (`setUp()` seeds `111`/`222` by default).
- Empty states render an `li.empty`, so count assertions use
  `#items-list li:not(.empty)`.
- Product names live in `value=""`, so assert with `toHaveValue`, not `toContainText`.
- **A session survives navigation between pages.** A test that wants a PIN screen calls
  `signOut(page)` *before* `goto` — clearing it after landing loses the race with the
  redirect. `openManagerPage()`/`openAdmin()` already do this.
- `seedUsers()` writes `test-config` and then reloads, because `window.APP_CONFIG` is merged
  once at boot; seeding without a reload leaves the page on the shipped config.
- Playwright URL globs do not match a query string: use `waitForURL(/manager\.html/)`, not
  `'**/manager.html'`, since every in-app navigation keeps `?test=1`.

## Deployment facts

- App: https://mohamedroshdi.github.io/mart-shipments/
- Manager: https://mohamedroshdi.github.io/mart-shipments/manager.html
- Admin: https://mohamedroshdi.github.io/mart-shipments/admin.html (PIN `7007` in the code)
- Production has **3 real users** (measured 2026-07-30), all on `فرع قويسنا`, created by the
  owner from the admin page. Any live script that saves the settings rewrites that list —
  read it back before assuming a run was harmless.
- Repo: https://github.com/MohamedRoshdi/mart-shipments (public — the URL is the
  only real protection; PINs are client-side gates, not security)
- Firebase project `shipments-alaela-mart`, Firestore `(default)` in `eur3`,
  free Spark plan. Catalog measured 2026-07-30: **10,043 products**.
- Pages builds take a few minutes and the builds API lags; verify with a
  cache-busted `curl` of the changed file instead of trusting the API status.

## Known limits (accepted, not bugs)

- No auth. Anyone with the URL can read, write and delete. Rules only validate shape.
  That now includes `config/app` (someone could rotate the PINs) and `logs` (someone could
  append a fake row) — the code-side admin PIN is the way back in, and audit rows cannot be
  edited or removed once written.
- `scripts/live-admin.mjs` leaves one audit row behind on purpose: the rules forbid deleting
  audit rows, so a live check of that collection cannot clean up after itself.
- Catalog search matches the **start** of a name; mid-word search needs a search service.
- The sync chip reports connectivity (`navigator.onLine`), not real sync state.
- Camera *decoding* can only be verified on a physical phone. `scripts/live-camera.mjs` proves
  the plumbing (camera list, chosen device, start/stop, release, ghost-camera fallback) with
  Chromium's `--use-fake-device-for-media-stream`; that fake stream never contains a barcode.
