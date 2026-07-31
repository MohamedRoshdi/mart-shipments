# mart-shipments — working notes for Claude

Shipment-intake PWA for a two-branch Egyptian supermarket. Employees scan barcodes into a
shipment on their phones, count a shelf against the quantity the shop's system says (الجرد),
record what is about to expire (الصلاحيات), or print a shelf label for a product (ليبل الرف);
a manager page reviews, edits, exports and
manages the product catalog; an admin page owns the settings, the audit trail and the
destructive tools. Arabic-only UI, RTL, offline-capable, free to run.

## Hard rules for this repo

1. **No framework, no bundler, no build step.** Plain ES modules served as files.
   npm exists only for Playwright. Never introduce a build.
2. **Arabic-only UI, clean Egyptian Arabic** (not stiff MSA). Every user-facing
   string lives in the HTML/JS as literal Arabic text. No i18n layer.
3. **Logical CSS properties only** (`margin-inline`, `inset-block-end`,
   `inline-size`, `border-start-start-radius`). Never `left`/`right`/`width` for
   layout. Barcodes, quantities and PINs get `dir="ltr"`. The one deliberate exception is the
   drawn chevron in `.action::after`: it is a shape that must always point the way the screen
   opens, and the physical sides are commented as such where they are used.
4. **Every interpolation into HTML goes through `esc()`** — and through
   `escAttr()` when it lands inside an attribute (`value="…"`, `data-…="…"`).
   Both `shipments` and `products` are publicly writable, so all stored text is
   untrusted.
5. **`db.js` is the only file that knows where data lives.** `app.js` and
   `manager.js` never touch Firestore or localStorage keys directly.
6. **Bump `CACHE` in `sw.js` on every deploy.** Serving is cache-first, so phones
   keep the old bundle until the cache name changes. Currently `mart-v39`.
   The bump only works because install fetches with `new Request(u, { cache: "reload" })` —
   a plain `addAll` reads the browser's HTTP cache and copies **stale** files into the new
   cache name (caught in Chrome 2026-07-31: `mart-v34` held a `style.css` 262 bytes behind
   the server's). Never drop that option.
7. **Deploy = push to master.** GitHub Pages serves the repo root. Firestore rules
   deploy separately: `npx firebase deploy --only firestore:rules --project shipments-alaela-mart`.

## Layout

| File | Role |
|---|---|
| `index.html` / `app.js` | employee app: setup, home, new/edit shipment **or stocktake**, **الصلاحيات** (months + one month), **ليبل الرف**, camera, item sheet |
| `manager.html` / `manager.js` | manager app: PIN, shipments tab, stocktake tab, **expiry tab**, one search box over the list, edit, catalog screen (with a **ليبل** link per row), import/export (Excel, TXT, ZIP by day/month) |
| `admin.html` / `admin.js` | admin app: users + permissions + phone binding, settings (branches, types, **suppliers**, **label size/paper/logo**, PINs), audit trail, bulk delete by kind/branch/type/day-range, catalog wipe |
| `auth.js` | permission list, PIN → identity, the 12-hour session shared by all three pages |
| `expiry.js` | the pure part of الصلاحيات: month grouping, sorting, counters, the four colour states |
| `label.js` | the whole of ليبل الرف that is not a screen: EAN-13 + Code 128 encoding, the barcode SVG, the label's HTML, and the settings guard. No db, no DOM, no session — that is what makes the price (or any other field) a one-line change later |
| `db.js` | data layer; `?test=1` switches the whole app to localStorage |
| `zip.js` | store-only ZIP writer, ~80 lines, no dependency; used by the folder export |
| `style.css` | one stylesheet for all three pages |
| `sw.js`, `manifest.json` | **one** installable PWA, on the main URL. `manager.html` and `admin.html` carry no manifest: the PIN routes people to their screen (`auth.landingPage`), and the home screen links to the other two. Dropped 2026-07-31 on the owner's call — a phone with three near-identical icons was the confusing part. |
| `firebase-config.js` | Firebase keys **plus** `APP_CONFIG`: PINs (incl. `adminPin`), branches, shipment types, suppliers, label settings |
| `firestore.rules` | shape validation; the only server-side guard that exists |
| `SETUP.md` | Arabic guide for the shop owner |
| `products-template.csv`, `stock-template.csv` | the two import shapes: barcode+name+**unit**, and barcode+name+quantity |
| `tests/app.spec.js` | 65 Playwright tests, all in localStorage mode |
| `scripts/*.mjs` | live checks and screenshot helpers (see below) |

## Data model

`shipments/{auto}` — `name` (**the supplier**), `createdBy`, `createdAt` (epoch ms), `branch`,
`type`, `items: [{barcode, name, qty, unit?}]`.

`counts/{auto}` — a stocktake (جرد): `name` (a shelf, never a supplier), `createdBy`,
`createdAt`, `branch`, `items: [{barcode, name, qty, sys, unit?}]`. `qty` is what the employee counted on the shelf,
`sys` what the imported sheet says the system holds. **`sys` is absent when the sheet never
listed that product** — writing 0 would claim the system said zero. No `type`: a count is
not a kind of shipment.

`expiry/{auto}` — one row per product **and date** (الصلاحيات): `barcode`, `name`, `qty`,
`day`, `month`, `year`, `branch`, `createdBy`, `createdAt`. **A month is never stored.**
`expiry.js months()` groups the rows, so a month appears with its first row and disappears
with its last one — nothing to create, nothing to clean up, and no empty months piling up.
Re-scanning the same barcode with the same date grows that row instead of adding a second.

`products/{barcode}` — `{ name, unit?, stock?: {branch: qty}, qty? }`. `unit` is the third column
of the catalog sheet (كرتونة / كيلو / علبة): shown next to the name and copied onto the item as
`item.unit`, **never counted, never summed, and never written into a TXT file**. The barcode **is** the document
id. **Each branch has its own sheet**, so the system quantity is a map keyed by branch name;
`qty` is the older shop-wide import (9,501 products carried it on 2026-07-30) and stays as the
fallback for any barcode a branch sheet has not covered. `db.stockFor(product, branch)` is the
one place that order is decided. Every product write is a **merge** — Firestore merges map
fields key by key, so importing شبين الكوم never touches what قويسنا imported, and renaming
from the catalog screen drops neither.

`config/app` — `{ managerPin, adminPin, branches: [{name}], shipmentTypes: [], users: [], suppliers: [],
label: { w, h, sheet, logo } }`. `label` is the shelf label: millimetres (66 × 35 by default —
the sheet the shop already buys), `sheet` is `"label"` (one label per page, thermal roll) or
`"a4"` (tiled on a sheet), and `logo` is the shop logo as a data URL, redrawn to 360 px before
it is stored because **every page reads this doc at boot**.
`suppliers` is a plain list of vendor names, typed one per line in the admin page and offered as
the shipment name — **a suggestion, never a constraint**: a name that is not on the list still saves.
Each user is `{ name, pin, branches: [], perms: [], device? }`; `perms` holds ids from `auth.js` `PERMS`
(`emp`/`mgr`/`adm` are screens, the rest are actions). **`branches: []` means every branch**, one
name means locked to it, several means the user works across them. `auth.branchesOf()` also reads
the old single `branch` string, so users saved before this still work.
The admin page writes it; every page merges it over `window.APP_CONFIG` at boot, so the
shipped `firebase-config.js` is only a fallback. A missing doc changes nothing.

`logs/{auto}` — `{ who, action, target, at }`. Append-only audit trail: manager and admin
mutations write a row, `update`/`delete` are denied by the rules.

Rules in force (all live-tested):
- `config`: only the doc id `app`, only those seven keys, PINs ≤ 8 chars, lists ≤ 10, users ≤ 40,
  suppliers ≤ 300, `label` a map of ≤ 6 keys whose `logo` is a string ≤ 200,000 chars.
- `logs`: create-only with the four keys; `update`/`delete` always denied.
- create: key allow-list, types, sizes, `items` ≤ 200.
- update: `name`, `items`, `type` may change; `createdBy`, `createdAt` and
  **`branch` are immutable** (403 on any attempt).
- delete: allowed on both collections (the owner asked for it).
- `counts`: the same shape as `shipments` minus `type`, `items` ≤ 500; `createdBy`,
  `createdAt` and `branch` immutable on update; delete allowed.
- `expiry`: create/delete open; `qty > 0`, `day` 1–31, `month` 1–12, `year` 2000–2100;
  update may change name/qty/date only — `barcode`, `branch`, `createdBy`, `createdAt` are
  immutable, so a row moves month but never changes product or branch. **Deployed and compiled,
  but not yet server-accepted:** the daily write quota was exhausted on 2026-07-30, so the live
  run's writes only ever reached the local cache. Re-run `scripts/live-expiry.mjs` after a quota
  reset and confirm with `scripts/live-expiry-server.mjs` (fresh context = server reads).
- `products`: create/update/delete open, `name` 1–100 chars, barcode ≤ 32, optional
  `qty` a number ≥ 0, optional `stock` a map of ≤ 10 branches (rules cannot iterate a map,
  so the per-branch values are only guarded client-side).

`createdAt` is `Date.now()` on purpose — `serverTimestamp()` reads back null in the
local cache and breaks the offline `orderBy('createdAt', 'desc')` list.

## Invariants that are easy to break

- **Only catalog barcodes may enter a shipment.** An unlisted barcode shows the
  refusal sheet (`#item-warn`), hides the qty stepper and the add button, and
  `btn-add-item` also refuses when called programmatically. Item names are never
  typed by employees — they come from `products` only.
- **The stocktake reuses the shipment screen, not a copy of it.** `state.mode` is `"ship"` or
  `"count"`; `paintMode()` swaps the labels, hides `#new-type-row`, and the item sheet grows
  `#item-stock`. The same rule holds as for shipments: an unlisted barcode is refused. A count
  never touches `localStorage.draft` — only shipments have a draft.
- **There is one scanner in `index.html`, and it moves.** `#scan-block` (scan button, reader,
  live camera controls, manual barcode field, **and the name search `#find-input` /
  `#find-results`**) lives outside `main`; `render()` appends it into
  `SLOTS[screen]` (`slot-new` / `slot-expiry` / `slot-label`) and hides it everywhere else. A second reader
  would mean a second camera stream and a second copy of every camera control. `navTo` stops
  the camera for any screen that has no slot.
- **The expiry writes are fire-and-forget, like the shipment and count adds.** `updateExpiry`
  and `deleteExpiry` do not await the server ack (measured on production 2026-07-30: awaiting
  left the item sheet open with no toast when the write sat behind a backoff, and it would do
  the same offline). The persistent cache applies the change immediately, so the screen repaints
  either way; a real failure surfaces through the `db-error` toast.
- **`ex.fromIso` is where a date becomes trustworthy.** It returns null outside `YEAR_MIN`–`YEAR_MAX`
  (2000–2100), the same window `firestore.rules` allows. Caught in the browser 2026-07-31: typing
  into the year segment of an `<input type="date">` produces a year like **202026**, the client
  accepted it, and because the write is fire-and-forget the phone would have said saved while the
  server dropped the row. Every date input also carries `min`/`max` so the browser marks it first.
- **الصلاحيات never counts a month, it derives one.** `ex.months(rows)` is the only place the
  grouping, the two counters, the nearest-first order and the four colours are decided, and both
  `app.js` and `manager.js` call it. Deleting the last row of a month leaves the screen through
  `paintMonth()`'s `history.back()` — the month is gone, so there is nothing left to paint.
  The colour is a border down the card edge (`li.exp-<status>`), never colour alone: the row
  also says «فاضل ٣٥ يوم» / «فاتت بـ ٢٠ يوم».
- **`label.js` knows nothing about the app, and it must stay that way.** No import of `db.js`,
  no `document`, no session: it takes a product plus `window.APP_CONFIG` and returns HTML. That is
  the owner's actual requirement («تكون ميزة الطباعة مستقلة») — the day the catalog carries a price,
  `labelHtml` already prints `item.price` and nothing else changes.
- **A 13-digit code is only an EAN-13 if the checksum adds up.** `label.js` computes it and falls
  back to Code 128 when it does not, because a barcode that scans as a *different* product is
  worse than one the till has to be taught. Code 128 uses subset C for an even-length run of
  digits (half the width) and subset B otherwise. Both tables are proved by round trip, not by
  eye: the test renders the SVG to a canvas and decodes it with the same html5-qrcode the scanner
  uses (`tests/app.spec.js` — «the printed barcode decodes back»). Never edit those tables
  without re-running it.
- **The label is sized in millimetres everywhere, and `@page` is the only way to set the paper.**
  A style attribute cannot carry `@page`, so `#print-size` (an empty `<style>` in `index.html`)
  is filled in right before `print()`. Printing hides everything else through
  `body > *:not(#print-area)`, and a thermal roll gets `.lbl + .lbl { break-before: page }` while
  A4 flows them across one sheet. Verified on paper, not on screen: `scripts/shots-label.mjs`
  prints to PDF with `preferCSSPageSize` and measures the `/MediaBox` (66.0 × 34.9 mm × 3 pages,
  measured 2026-07-31).
- **Nothing about a label is saved.** No collection, no draft, no audit row — the screen reads a
  product and prints. Only the copy count is remembered, in `localStorage.printSettings`, per
  phone (the same reasoning as the camera settings). The price is typed on the screen and dies
  with it.
- **`#label=<barcode>` is consumed once.** The manager's catalog row links to the employee app
  with that hash; `openDeepLabel()` runs from `goHome()`, drops the hash with `replaceState`
  before opening the screen, and re-checks the permission. Without dropping it, every later trip
  home would jump back into the label screen.
- **`sys` is read for free, and it is per branch.** The quantities live on the product doc, so
  a scan still costs the one `getProduct` read it always cost. `state.branch` (the branch the
  count is stamped with, not `myBranch()`) picks which number the employee sees. Never add a
  second collection for it.
- **One chip drives both directions.** `stockBranch` in `manager.js` feeds the import *and* the
  catalog export, so the file that comes out (`الباركود، الاسم، الكمية في <الفرع>`) is exactly
  the file that goes back in. The import reads the **last** column as the quantity — which is
  why `unit` is never added to that export: it would land in the quantity column on the way
  back. The catalog sheet is the other file (`الباركود، الاسم، الوحدة`), and there `unitOf()`
  takes the last cell **unless it is numeric**, so a stocktake sheet imported into the wrong
  box cannot turn a quantity into a unit.
- **The shipment name is the supplier, and the list only suggests.** `renderSuppliers()` in
  `app.js` filters `APP_CONFIG.suppliers` with `db.norm` (prefix hits first, then anything
  containing the term) and shows nothing during a stocktake — a shelf has no supplier. Typing a
  name that is not on the list is allowed on purpose: a new supplier at the door must not block
  a delivery. The manager's `#list-search` runs the same matcher over the shipment name **and**
  the employee name, so one supplier's deliveries come up in one search.
- **The difference is computed, never stored.** `countDiff()` in both `app.js` and
  `manager.js` sums `qty - (sys || 0)`; an item with no `sys` counts as pure surplus, which
  is what an unlisted product on the shelf actually is.
- **`auth.js` owns identity for all three pages.** `authenticate(pin, cfg, codeAdminPin)` tries
  the admin's users first, then the two legacy PINs (admin → every permission, manager → all
  but `adm`). **Branch PINs are gone** (dropped 2026-07-31 on the owner's call): a branch is a
  field on an account, not a password, and `config/app.branches` is now `[{name}]`. Anything
  that still carries a `pin` key on a branch is old data and is ignored — the next settings
  save strips it. The result goes into `localStorage.session` for 12 hours and every page
  reads it, so signing in once covers all three. **`canDo(perm)` returns true when there is no
  session at all** — that is what keeps the pre-users behaviour intact for a shop that never
  creates a user.
- **A user account belongs to one phone.** `auth.deviceId()` writes a random id into
  `localStorage.deviceId` once per phone. The first sign-in with a user PIN claims the account
  (`db.claimDevice` patches only `users` on `config/app`, and never touches an account that
  already carries a `device`); any other phone using that PIN gets `{ blocked: true }` from
  `authenticate` and the three pages refuse it. Only the admin page frees it — «فك الارتباط»
  drops `device`, and the next phone claims it. Two things this does not do: it does not end a
  session already running on the old phone (12 h at most), and clearing the phone's site data
  makes a new id, so that phone also needs unbinding. Legacy PINs (admin/manager/branch) are
  never bound — the code admin PIN stays the way back in.
- **`device` must survive a settings save.** `admin.js` builds the payload key by key, so any
  new user field has to be copied there or every save silently unbinds every user.
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
  Torch, zoom and continuous focus go through `applyVideoConstraints({advanced:[…]})`; torch
  and zoom only appear when `getRunningTrackCapabilities()` reports them.
- **Resolution is a start-time constraint, and html5-qrcode drops the first argument once
  `config.videoConstraints` is valid** — so the chosen `deviceId` has to live *inside* the same
  object as `width`/`height`, never beside it. Measured with the fake device 2026-07-30:
  no constraint → **640×480**, `res: "fhd"` → **1920×1080**, default `res: "hd"` → 1280×720.
  That default is why a small barcode reads on one phone and not another; `ideal` (not `exact`)
  so a camera that cannot do it still starts. `navTo` calls `stopScan()` for any screen other
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
- **Each ZIP is grouped by the thing that identifies its rows**, which is not the same field
  everywhere: shipments are `YYYY-MM-DD/النوع/اسم الشحنة.csv|txt`, a stocktake is
  `YYYY-MM-DD/اسم الجرد.csv`, and الصلاحيات is `<شهر سنة>/الصلاحيات.csv` — a month, never a
  day, because that is what an expiry row is filed under. `dayOf()` uses `en-CA`, so the
  folder name sorts itself; `uniquePath()` appends ` (2)` rather than letting a repeated name
  overwrite an earlier entry.
- **The admin bulk delete covers `shipments` and `counts`**, filtered by branch, type
  (shipments only — a count has none) and a `from`/`to` day range compared as plain
  `YYYY-MM-DD` strings. `db.deleteMany` maps the collection to its localStorage list in test
  mode, so adding a collection there means adding it to that map too.
- **Every `db.js` export awaits `live()`**, which resolves `initDb()`. Without it a
  call that lands before the Firebase SDK finishes throws on `fs` being null — this
  once made the catalog import silently save 0 rows.
- **The look is one stylesheet and four rules** (2026-07-31 pass): filter chips live in a
  single row that **scrolls sideways** (`.seg` is `nowrap` + `overflow-x:auto`) — wrapping rows
  were pushing the list below the fold — and on the manager page those rows are **behind
  `#btn-filters`**, on the same line as the search box. `renderFilterBar()` keeps `#filters` open
  whenever a filter is actually on and writes the active values onto the button, so a filtered
  list can never look like the whole list; the button hides itself when there is nothing to
  filter (one branch in scope, and not the shipments tab). A filter is labelled inside its row
  (`.filter-row` + `.filter-label`), not by a heading above it; cards carry `box-shadow: var(--sh)` instead of a
  border; and **no Arabic text ever gets `letter-spacing`** — it is a joined script and spacing
  breaks the ligatures. `.code` is `direction:ltr` **plus `unicode-bidi:isolate`**, and it wraps
  the barcode ONLY: putting Arabic inside it is what produced «فى الـنـظام» in the catalog rows.
  **A list card carries no buttons at all** (2026-07-31, the owner's «a lot of buttons»): the card
  *is* the button (`button.card-open`, same drawn chevron as the home cards), and نسخ / Excel /
  TXT / حذف all live on the screen it opens — which is the same two taps they used to take. The
  branch filter row hides itself when the user is scoped to one branch, because a single disabled
  chip is a row that does nothing.
- **`[hidden] { display: none !important }` in `style.css` must stay.** A class
  with `display: flex/grid` otherwise outranks the `hidden` attribute and the
  element stays visible.
- **Specificity traps:** `.row-actions button` overrides `.primary`; add explicit
  `.row-actions button.primary` when a row button must be amber.
- **The item sheet owns the screen while open** (scrim + `body.sheet-open` hides
  the bottom bar). Anything behind it is unclickable — dismiss with `#btn-cancel-item`.
- **Two ways in, both still live.** With users configured, the PIN alone identifies the person
  and the branch comes from their account. With **no users at all**, `#screen-name` still asks
  for a name and a branch and nothing else — no password guards that path any more, which is
  accepted because the app has no auth to begin with (the URL is the protection). Shipments
  always carry a branch and the manager can never move one between branches (the rules forbid
  it).
- **Manager scope filters before render**, never after: `openManager()` drops other branches
  out of `all`, so a scoped user's page never holds data they may not see.
- Catalog screen loads `PRODUCT_CAP = 300` rows; `countProducts()` gives the honest total.
  Export uses `listAllProducts()` — one deliberate full read.
- **Search matches the middle of a name, and that is why the catalog is cached.** Firestore
  answers prefix queries only, so `db.catalogIndex()` pulls the whole catalog once per phone
  into `localStorage.catalogIndex` (7-day TTL, memoised in `indexRows`) and `searchProducts`
  matches over it: name-prefix and barcode-prefix hits first, then anything containing the
  term, `HITS = 50`. `norm()` folds أ/إ/آ→ا, ة→ه, ى→ي and strips tatweel/harakat, so a phone
  keyboard reaches every row. The server prefix query stays as the fallback for a term the
  local copy has never seen. **The price is one full read (10,043 docs measured 2026-07-30)
  per phone per week** against a 50k/day quota — that is why `writeProduct`/`deleteProduct`
  call `dropCatalogIndex()` instead of anything refreshing on a timer.

## Commands

```bash
npx playwright test                 # 59 tests, localStorage mode, ~30s
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
STAMP=$RANDOM node scripts/live-count.mjs        # الجرد: stock sheet, count, difference, Excel, delete
STAMP=$RANDOM node scripts/live-expiry.mjs       # الصلاحيات: record a date, merge, move month, Excel, delete
node scripts/live-expiry-cleanup.mjs             # janitor for a live-expiry run that died mid-way
node scripts/live-expiry-server.mjs              # fresh context: what the SERVER holds, no local cache
node scripts/live-users-probe.mjs                # read-only users list; TIME=1 also times one save ack
node scripts/live-mobile-known.mjs               # read-only: Pixel 5 on the live site, a real catalog barcode
OUT=/tmp/shots node scripts/shot-refused.mjs     # read-only: the refusal sheet, settled, on the live site
OUT=/tmp/shots node scripts/shot-live-manager.mjs # read-only: one shot of the live manager screen
BASE=http://localhost:8087 node scripts/live-camera.mjs   # camera list/start/stop/fallback on a fake device
OUT=/tmp/shots node scripts/shots.mjs            # local screenshots (needs the server above)
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-expiry.mjs   # home + الصلاحيات screens
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-all.mjs      # all 16 screens, the visual reference set
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-search.mjs   # the name search on all three modes
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-supplier.mjs # the supplier list, admin side and employee side
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-label.mjs    # ليبل الرف + prints 3 copies to PDF and measures the page (exits 1 if the paper is wrong)
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-manager-list.mjs # the manager list, a card screen, the stocktake tab
```

Writing live scripts: pull real barcodes from the catalog first — invented ones are
refused by design. Never `waitUntil: "networkidle"`; Firestore keeps a socket open,
so it never fires. A helper that reads the search results must wait out the 250 ms
debounce, or it reports false negatives.

## Testing notes

- Tests run with `?test=1`; `db.js` then uses `test-shipments` / `test-products` /
  `test-counts` / `test-expiry` in localStorage. An `expiry` seed carries its own `_id`
  (`saveExpiry` writes `createdAt-barcode`, because two rows can land in the same millisecond). Seed `test-products` in any test that adds items, or the add
  is refused (`setUp()` seeds `111`/`222` by default).
- A `test-products` value may be a plain string **or** `{name, qty?, unit?, stock?}` — the string
  form is kept so older seeds still work, `qty`/`stock` is what a stocktake compares against, and
  `unit` is what the item sheet shows.
- `seedSuppliers()` writes `test-config.suppliers` and reloads, same reason as `seedUsers()`.
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
- Catalog search reads a **copy of the catalog taken up to 7 days ago** (`localStorage.catalogIndex`).
  A product added from another phone is findable by scanning its barcode immediately — that is a
  direct doc read — but by name only after this phone refreshes the copy, or through the server
  prefix fallback when the local copy returns nothing. Any product write on the phone drops the
  copy at once.
- **The free Spark plan is 20k writes / 50k reads a day, and a full sheet import is one write
  per row.** The owner's catalog is ~10k products, so two full imports in a day exhaust the
  write quota; Firestore then answers `[code=resource-exhausted]: Quota exceeded` and writes
  crawl behind an exponential backoff (measured 2026-07-30 18:14 UTC — a `config/app` save
  produced no toast, and the temp user only appeared seconds later). Quotas reset at midnight
  Pacific. Import per branch, not the whole catalog repeatedly.
  Measured again at 18:55 UTC the same day: an **idempotent** `config/app` save (press save with
  nothing changed) never acked in 90 s, with `resource-exhausted` + "Using maximum backoff delay"
  in the console. That is what blocks `scripts/live-mobile.mjs` at its first step — it creates a
  temp user, and `saveConfig` is the one write in the app that waits for the server on purpose.
  Everything else is fire-and-forget, so a live run **passes on the local cache while the server
  has none of it**: `scripts/live-expiry-server.mjs` opens a fresh context and asks the server
  directly. Use it before believing any live "it worked".
- A stocktake reports on what was **scanned**. A product in the sheet that nobody scanned does
  not appear as a shortage — listing every missing product would mean reading the whole
  catalog (10k reads) per count. Count by shelf and the sheet stays honest.
- **Printing goes through the browser's print dialog, never straight to the printer.** A web page
  cannot open a USB or Bluetooth thermal printer itself, so «طباعة» hands the pages to the OS:
  on a PC that is the normal printer dialog (pick the XPrinter/Zebra/TSC/Brother driver, paper
  size comes from `@page`), on Android it needs a print service installed. Any printer with a
  driver works — the app never speaks ESC/POS or ZPL. Margins and scaling still belong to the
  driver: «الحجم الفعلي / 100%» must be picked once, or the label prints shrunk to fit.
- The label carries no price until the catalog has one. `labelHtml` prints `item.price` when it
  is there, and the printing screen lets one be typed for that print only.
- The sync chip reports connectivity (`navigator.onLine`), not real sync state.
- Camera *decoding* can only be verified on a physical phone. `scripts/live-camera.mjs` proves
  the plumbing (camera list, chosen device, start/stop, release, ghost-camera fallback) with
  Chromium's `--use-fake-device-for-media-stream`; that fake stream never contains a barcode.
