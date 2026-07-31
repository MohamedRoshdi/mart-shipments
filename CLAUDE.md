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
   keep the old bundle until the cache name changes. Currently `mart-v52`.
   **Bump `version.js` in the same edit** — its `VERSION` ends in the cache generation
   (`1.0.52`) and `BUILD` is the day, and every page prints both in its footer. A footer that
   lags the cache is worse than no footer.
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
| `manager.html` / `manager.js` | manager app: PIN, shipments tab, stocktake tab, **expiry tab**, a **month picker** that decides what is read, one search box over the list, filters behind `#btn-filters`, cards that open (no row buttons, but a **«تم تحميلها»** tag), edit, **«تم التحميل»** on the card screen, catalog screen (with a **ليبل** link per row), import/export (Excel, TXT, **ZIP by day**) |
| `admin.html` / `admin.js` | admin app: users + permissions + phone binding, settings (branches, types, **suppliers**, **label size/paper/logo**, PINs), audit trail, bulk delete by kind/branch/type/day-range, catalog wipe |
| `auth.js` | permission list, PIN → identity, the 12-hour session shared by all three pages |
| `expiry.js` | the pure part of الصلاحيات: month grouping, sorting, counters, the four colour states |
| `label.js` | the whole of ليبل الرف that is not a screen: EAN-13 + Code 128 encoding, the barcode SVG, the label's HTML, and the settings guard. No db, no DOM, no session — that is what makes the price (or any other field) a one-line change later |
| `erp.js` | what PowerTech leaves behind after an import, pure: `pulledRows`, `isImported` (the «1» flag in field 5 of every row), `permitOf` (`store 1_4552.txt` → `4552`), `sameGoods`. Built from a measured pulled file, never guessed. Nothing wires it to `erpAt` yet — blocked on where the pulled file lives |
| `brand.js` | the uploaded logo (config `label.logo`) as the app-bar image and the tab icon on all three pages; no logo in the config = the pages look exactly as before |
| `db.js` | data layer; `?test=1` switches the whole app to localStorage |
| `zip.js` | store-only ZIP writer, ~80 lines, no dependency; used by the folder export |
| `sheet.js` | everything about reading a spreadsheet: `sheetRows` (**a real `.xlsx`** — zip walk + `DecompressionStream` — or CSV read field by field, quotes and all, and the only place that knows Excel writes Arabic as windows-1256), `headerMap` (columns by Arabic heading, so the shop's own export order works), **`requireColumns`** (the guard: no headings → positional, headings with a column missing → **throws in Arabic naming it**), `unitName` (unit **code** → word, `null` for a code the table does not know) and `unitCode` (the number itself, kept only when it is 1–5). Used by the catalog/stock import (manager) and the supplier import (admin) |
| `style.css` | one stylesheet for all three pages |
| `desktop/` | the Windows build: `main.js` (serves the repo root over `http://127.0.0.1` on a random port, plus the three IPC handlers), `preload.js` (the whole `window.mart` contract), `package.json` (electron + electron-builder, kept entirely in here so the repo no-build rule still holds for the web target). **Never loaded by the web version** |
| `files.js` | where a file goes when it leaves the app: `window.mart` bridge → File System Access folder handle (IndexedDB, chosen once) → the `<a download>` that has always happened. Also `listFolder`/`readText` (what the ERP check will read back), `uniqueName`, `safeSegment`, and the single copy of `downloadBlob` |
| `version.js` | the release, in one place: `APP_NAME`, `VERSION`, `BUILD` and `versionLine()`. All three pages print it in a footer. `BUILD` is a literal on purpose — `new Date()` would print the day the page was *opened*, which looks like a build date and is not one |
| `sw.js`, `manifest.json` | **one** installable PWA, on the main URL. `manager.html` and `admin.html` carry no manifest: the PIN routes people to their screen (`auth.landingPage`), and the home screen links to the other two. Dropped 2026-07-31 on the owner's call — a phone with three near-identical icons was the confusing part. |
| `firebase-config.js` | Firebase keys **plus** `APP_CONFIG`: PINs (incl. `adminPin`), branches, shipment types, suppliers, label settings |
| `firestore.rules` | shape validation; the only server-side guard that exists |
| `SETUP.md` | Arabic guide for the shop owner |
| `products-template.csv`, `stock-template.csv`, `suppliers-template.csv` | the three import shapes, **each one exactly what the ERP exports**: «كود الصنف، الوحدة، اسم الصنف، معامل التحويل»، «الرصيد، كود الصنف، الوحدة، اسم الصنف»، «كود المورد، اسم المورد» |
| `tests/app.spec.js` | 88 Playwright tests, all in localStorage mode |
| `scripts/*.mjs` | live checks and screenshot helpers (see below) |

## Data model

`shipments/{auto}` — `name` (**the supplier**), `supplierCode?` (the code in the shop's own system,
**looked up from the name at save time, never typed** — `db.supplierCodeOf`), `createdBy`,
`createdAt` (epoch ms), `branch`, `type`, `items: [{barcode, name, qty, unit?}]`, and the
«تم تحميلها» pair `loadedBy?` / `loadedAt?` — **absent means nobody has taken this shipment into
the shop's own system yet**. There is no boolean: the two fields are the state and the receipt.
`erpAt?` / `erpFile?` are the stage after it: when the shop's own system actually took the file in,
and which file proved it. **Nothing writes them yet** (see the ERP-state invariant), but both are
released in `firestore.rules` so the first write is not a 403; `erpState()` reads them today.

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

`products/{barcode}` — `{ name, unit?, unitCode?, price?, factor?, stock?: {branch: qty}, qty? }`. `unitCode`
is the ERP's own unit number kept beside the word (**1–5 only**, so an unknown code is never stored):
nothing displays it, it exists so a future export can send back exactly what the ERP sent. `factor` is
معامل التحويل from the catalog sheet: **shown on the item sheet and nowhere else, never multiplied
by anything**, and only stored when it is greater than 1 (1 means no conversion, which is most of a
10k catalog — not worth a key on every doc). `unit` is the unit
column of the catalog sheet (كرتونة / كيلو / علبة): shown next to the name and copied onto the item
as `item.unit`, **never counted, never summed, and never written into a TXT file**. `price` is the
shop's last selling price, and the only thing that reads it is the shelf label — it fills itself in. The barcode **is** the document
id. **Each branch has its own sheet**, so the system quantity is a map keyed by branch name;
`qty` is the older shop-wide import (9,501 products carried it on 2026-07-30) and stays as the
fallback for any barcode a branch sheet has not covered. `db.stockFor(product, branch)` is the
one place that order is decided. Every product write is a **merge** — Firestore merges map
fields key by key, so importing شبين الكوم never touches what قويسنا imported, and renaming
from the catalog screen drops neither.

`config/app` — `{ managerPin, adminPin, branches: [{name}], shipmentTypes: [], users: [], suppliers: [],
label: { w, h, sheet, logo, gap } }`. `label` is the shelf label: millimetres (66 × 35 by default —
the sheet the shop already buys), `sheet` is `"label"` (one label per page, thermal roll) or
`"a4"` (tiled on a sheet), `logo` is the shop logo as a data URL, redrawn to 360 px before
it is stored because **every page reads this doc at boot**, and `gap` is seconds between products
on the roll (0 = one job for the lot).
`suppliers` is a list of `{code, name}` (a plain string is an older row and still reads, through
`db.supplierList`), typed one per line as «كود، اسم» in the admin page — or imported from a sheet —
and offered as the shipment name — **a suggestion, never a constraint**: a name that is not on the
list still saves, with an empty code.
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
  suppliers ≤ 1000 (the shop's real list is 425 — 300 was refusing their save), `label` a map of
  ≤ 6 keys whose `logo` is a string ≤ 200,000 chars.
- `logs`: create-only with the four keys; `update`/`delete` always denied.
- create: key allow-list, types, sizes, `items` ≤ 200, optional `supplierCode` a string ≤ 20,
  optional `loadedBy` a string ≤ 50 and `loadedAt` a number, optional `erpAt` a number and
  `erpFile` a string ≤ 200.
- update: `name`, `items`, `type`, `supplierCode`, `loadedBy`, `loadedAt`, `erpAt` and `erpFile`
  may change;
  `createdBy`, `createdAt` and **`branch` are immutable** (403 on any attempt). A re-load is an
  ordinary overwrite of the two loaded keys — the audit trail, not the doc, is what keeps the history.
- delete: allowed on both collections (the owner asked for it).
- `counts`: the same shape as `shipments` minus `type`, `items` ≤ 500; `createdBy`,
  `createdAt` and `branch` immutable on update; delete allowed.
- `expiry`: create/delete open; `qty > 0`, `day` 1–31, `month` 1–12, `year` 2000–2100;
  update may change name/qty/date only — `barcode`, `branch`, `createdBy`, `createdAt` are
  immutable, so a row moves month but never changes product or branch. **Server-accepted, measured
  2026-07-31**: `scripts/live-expiry.mjs` ran end to end against production (14 steps, including
  its own cleanup) once the write quota had reset, and `scripts/live-expiry-server.mjs` shows the
  server holding only the shop's own months.
- `products`: create/update/delete open, `name` 1–100 chars, barcode ≤ 32, optional
  `qty`, `price` and `factor` numbers ≥ 0, optional `unitCode` an int 1–5,
  optional `stock` a map of ≤ 10 branches (rules cannot
  iterate a map, so the per-branch values are only guarded client-side).

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
- **Nothing about a label is saved — including the copy count.** No collection, no draft, no audit
  row, and since 2026-07-31 no `localStorage.printSettings` either: the box opens on **1** every
  time, on the owner's own instruction («وثبت عدد النسخ ١ وانا ازود براحتى»). Remembering the last
  count meant a screen that opened on 3 because somebody once printed 3. The price is typed on the
  screen and dies with it, and so does the print queue: leaving the screen empties it.
- **An empty price box is not a broken screen.** `showLabel` fills the price from the product when
  the catalog carries one; when it does not, `#label-price-note` says so in as many words, because
  a blank box next to a barcode reads as a bug. The catalog only carries a price when a sheet with
  an «اخر سعر بيع» column has been imported — **and the shop's catalog export has no such column
  and never will** (the owner, 2026-08-01): a future price would come from a separate file, so the
  typed-per-print price is the normal case, not the fallback. The header pattern stays because it
  costs nothing and a price file may reuse it.
- **The label is the shop's own design, and the price is the loud part** (their label software,
  2026-07-31): logo, then the price at 8 mm with a small `LE`, then the name, the bars, the number
  centred and the print date tucked in the corner. Every row is always in the markup — a label
  with no logo and no price still lines up, because the rows are a fixed `grid-template-rows`.
  `.lbl` carries a real 0.3 mm border: on A4 it is the cut line, on a roll it frames the label.
  It sits on the very edge of the page, so a printer with an unprintable margin will clip it —
  inset the label if that ever shows up on paper.
- **A print job cannot pace its own pages** (the owner asked for 5–10 s between products on the
  roll, 2026-07-31). The page hands the whole job to the OS and has no say in when a page leaves
  the printer, and there is no silent printing on the web. So `label.gap > 0` means **one job per
  product** — which costs one printer dialog each, and the settings screen says so in as many
  words. Off by default; A4 ignores it, because a sheet is one piece of paper. The wait is checked
  in 100 ms slices so «إيقاف الطباعة» does not have to sit through it.
- **«طباعة» prints the queue plus whatever is still on the screen.** One label stays one tap;
  twenty items are one tap each plus one at the end. `sheetHtml` expands `copies` per row, so the
  page count is the sum, and `#label-count` in the bottom bar is what will actually come out —
  which is why the copies box re-renders it on every keystroke.
- **`#label=<barcode>` is consumed once.** The manager's catalog row links to the employee app
  with that hash; `openDeepLabel()` runs from `goHome()`, drops the hash with `replaceState`
  before opening the screen, and re-checks the permission. Without dropping it, every later trip
  home would jump back into the label screen.
- **`sys` is read for free, and it is per branch.** The quantities live on the product doc, so
  a scan still costs the one `getProduct` read it always cost. `state.branch` (the branch the
  count is stamped with, not `myBranch()`) picks which number the employee sees. Never add a
  second collection for it.
- **The header row decides the columns, and only then does position matter.** The shop's own
  system exports the catalog as «كود الصنف | الوحدة | اسم الصنف | معامل التحويل | اخر سعر بيع» and
  the stock sheet as «الرصيد | كود الصنف | الوحدة | اسم الصنف» — the quantity first. `sheet.js
  headerMap()` reads the first row and returns column indexes, or null when that row is data; both
  importers fall back to the old positional rules then, so every sheet that used to work still
  does. The unit arrives as a **code**, not a word (`unitName`: 1 قطعة، 2 كيلو، 3 علبة، 4 كرتونة،
  5 عرض); a non-numeric cell is taken as the word it already is. `معامل التحويل` is ignored on
  purpose — nothing in the app multiplies units.
  **Three cases, not two, and `requireColumns` is where they are told apart.** `looksLikeHeader`
  needs **two** known headings before it calls a row a header — one lucky word must not swallow the
  first row of products. No headings → positional, exactly as before. Headings **with a required
  column missing** → the file is refused whole, naming the column («الملف ناقصه عمود «اسم الصنف»»),
  because falling through to positions there writes the wrong column under the right barcode and
  nobody finds out until a shelf count disagrees. Required: catalog = كود الصنف + اسم الصنف، stock
  = الرصيد + كود الصنف + اسم الصنف، suppliers = كود المورد + اسم المورد.
  **The supplier file is header-driven too** (`admin.js`), so the ERP's column order stops mattering
  there as well; `parseSupplier` survives only for the textarea, where a person types «كود، اسم» by
  hand. The same code twice in one file is one supplier, the later row winning.
  **The headings are matched in Arabic only, and the quantity one has to allow a suffix**: the
  catalog export writes «الكمية في فرع قويسنا», so the pattern ends in `( في .+)?`. (The shipped
  `stock-template.csv` said «الكمية في النظام» until the templates were re-cut to the ERP's own
  shapes; the pattern still carries both.) Measured 2026-07-31: without it `headerMap`
  matched barcode + name, found no quantity column, and the shop's own template imported **zero
  rows** — the tests missed it because the fixtures use English headings and fall through to the
  positional path. `tests/fixtures/catalog.csv` deliberately keeps a comma inside a name, which
  only the positional path can carry, so adding English headings here would break it.
- **CSV is read field by field, not split.** Excel quotes any cell holding the separator, and
  «شيبسي، ٣٠ جم» is a real product name — `text.split(/[,;\t]/)` turned that one cell into two and
  shifted every column after it. It was invisible while the positional readers swallowed the middle
  cells; once the columns come from the header row it is a wrong import, so `csvRows` handles quoted
  fields, `""` inside them, and separators or newlines inside quotes. The separator is sniffed from
  the first line (`,` `;` `\t` — Excel on Arabic Windows writes `;`).
- **An `.xlsx` is read here, without a dependency.** `sheetRows` sniffs `PK\x03\x04`, walks the zip
  central directory by hand and inflates each entry with `DecompressionStream("deflate-raw")` — the
  browser already owns the hard part. Only `xl/sharedStrings.xml` and the first `xl/worksheets/sheetN.xml`
  are parsed, which is all a shop export has. **A barcode Excel stored as a number is the risky
  case** (`<c>` with no `t` attribute), so `tests/fixtures/catalog.xlsx` deliberately holds one of
  each; regenerate it with `node scripts/make-xlsx-fixture.mjs`, never by hand. A file that is not a
  spreadsheet now **throws in Arabic** instead of returning an empty list — every importer used to
  answer «تم استيراد 0 صنف» for a file it simply could not read, which is what the shop saw when
  they uploaded a real `.xlsx`. The old binary `.xls` is refused by its `D0CF11E0` magic with the
  Save-As instruction, because there is no way to read it without a real dependency.
- **An unknown unit code is a refused row, not a silent one.** `unitName` returns `""` when the
  sheet said nothing and **`null`** when it gave a code outside 1–5; the catalog import drops the
  `null` rows, says how many and names the first three barcodes. Telling the two apart is the whole
  point: a missing column must leave the unit alone.
- **A stock sheet must never wipe the price, and a catalog sheet must never wipe the stock.**
  `saveProductName` only writes the keys it was given and `writeProduct` merges, so an import that
  has no price column leaves the price alone.
- **One chip drives both directions.** `stockBranch` in `manager.js` feeds the import *and* the
  catalog export, so the file that comes out (`الباركود، الاسم، الكمية في <الفرع>`) is exactly
  the file that goes back in. The import reads the **last** column as the quantity — which is
  why `unit` is never added to that export: it would land in the quantity column on the way
  back. The catalog sheet is the other file (`الباركود، الاسم، الوحدة`), and there `unitOf()`
  takes the last cell **unless it is numeric**, so a stocktake sheet imported into the wrong
  box cannot turn a quantity into a unit.
- **«تم تحميلها» is written by the export, and only somebody else has to confirm.** `markLoaded()`
  in `manager.js` is the one place `loadedBy`/`loadedAt` are set, and نسخ / Excel / TXT all go
  through it — downloading the file *is* taking the shipment into the shop's system. The same
  person taking Excel and then TXT is **one** loading: it returns early, so there is no dialog and
  no second audit row. A different `identity` gets the confirm naming who loaded it and when, and
  writes `إعادة تحميل شحنة`. «تم التحميل» on the card screen passes `force` so the button always
  means "load it now". A stocktake is never loaded — `#detail-load` is hidden for a count.
- **The manager page reads one month.** `db.listShipments(month)` / `listCounts(month)` take a
  `"YYYY-MM"`; `monthRange()` turns it into a `createdAt` range on the field the query is already
  ordered by, so no composite index is needed, and `null` still means everything (the «كل الشهور»
  option, `app.js`, and the admin bulk delete all rely on that). The picker defaults to the current
  month — **and `openManager()` falls back to «كل الشهور» once when that month is empty**, or the
  shop would open the app on the first of the month and see nothing. الصلاحيات is not month-scoped
  here: its rows are filed by the expiry date, not by the day they were typed.
- **The supplier code is derived, never entered.** `db.supplierCodeOf(cfg, name)` resolves it from
  the saved name at save time, in `app.js` and in the manager's edit screen alike, so a shipment can
  never carry another supplier's code and renaming one moves the code with it. Old shipments keep
  the code they were saved with.
- **The shipment name is the supplier, and the list only suggests.** `renderSuppliers()` in
  `app.js` filters `db.supplierList(APP_CONFIG)` with `db.norm` — **on the name and on the code**,
  because the storekeeper knows «1042» before he knows the spelling (prefix hits first, then anything
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
- **The ERP state is derived, never stored.** `erpState(s)` reads `erpAt` → «تم الاستيراد»,
  `loadedAt` → «جاهزة للاستيراد», neither → «جديدة». The absence of a key IS a state, the same
  shape as «تم تحميلها»; there is no status column to keep in step with the two timestamps that
  already say everything. **Nothing sets `erpAt` yet**, but the flag is no longer a guess:
  `erp.js` reads it, built from a real pulled file (`store 1_4552.txt`, measured 2026-08-01) —
  six tab fields per row, `barcode \t qty(5 decimals) \t \t \t 1 \t CRLF`, the «1» in the fifth
  field of EVERY row is the success flag, and the ERP renames the file to `store <n>_<permit>.txt`
  so the CONTENT (`sameGoods`) is the identity, never the name. The app's own two-field file can
  never read as imported, and one unflagged row means not imported. What still blocks the
  `erpAt` write: **where the pulled file lives** — whether PowerTech rewrites the file in
  `D:\import\<folder>` in place, deletes it, or writes its copy somewhere else. Asked 2026-08-01.
- **The manager opens on «النهارده والمعلّق», and that is a filter, not a query.** `#month-pick`
  gained it as its first option and its default. It reads **this month and last** — two bounded
  reads, because an unfinished shipment must not vanish at midnight on the 1st — and then shows
  today's shipments plus every older one that is not «تم الاستيراد» (`isOpen`). A shipment leaves
  the screen only when both stages are done. Anything older than last month is the archive, behind
  a real month or «كل الشهور». `lastMonth()` builds the date from its parts: `setMonth(-1)` on the
  31st lands back in the same month, because June has no 31st.
- **The counters count what is loaded, not what is shown.** A manager narrowing to one branch still
  needs the overall backlog, and a number that moved with every keystroke in the search box would
  be noise. They honour the branch filter and nothing else. Four numbers, laid out **2×2 on a phone
  and 1×4 above 560px** — the filter chips scroll sideways because there can be any number of them;
  these are exactly four, and the one that scrolled off a 412px phone was «معلّقة», the number the
  manager most needs. Caught in a screenshot, not by a test.
- **A duplicate permit is asked about, never decided.** `fingerprint()` in `manager.js` is
  type + branch + normalised supplier + every `barcode:qty` sorted — computed on the fly, so there
  is no stored hash to migrate or to fall out of step with the items. Two deliveries of the same
  goods on the same day are a real thing, so the app cannot refuse; it names the earlier permit and
  its author and lets the manager go on. The question is asked **before** `markLoaded()` — backing
  out of a TXT must not leave the shipment marked «تم تحميلها».
  Test-mode trap: `_id` is `String(createdAt)`, so two fixtures created in the same millisecond
  share an id and each is skipped as "itself". Seed twins with different timestamps.
- **`config/app` is the one live listener in the app, and admin.js deliberately has none.**
  `db.watchConfig(cb)` is an `onSnapshot` that fires once immediately from the cache and again on
  every change, so a permission, a branch, a supplier or a shipment type edited on another machine
  reaches a phone in seconds. `app.js` and `manager.js` re-merge and repaint **only what is derived
  from the config** — `state.branch` is left where it is unless it stopped being allowed, because
  moving it mid-shipment would stamp the delivery with the wrong branch. **`admin.js` must never
  watch**: the admin IS the writer and holds an unsaved working copy (`cfg`), so a live update
  there would silently overwrite what somebody is typing.
  This is also the answer to the «كل 10 إلى 30 ثانية» in the sync spec: a listener costs one read
  per real change, a 30 s poll costs one per interval per phone against a 50k/day quota, and the
  listener is faster. In `?test=1` it listens for the `storage` event — a second tab.
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
- **Every ZIP is one folder per day** (2026-07-31, the owner's call — the type level under a
  shipment day meant three taps to reach one file): shipments are `YYYY-MM-DD/اسم الشحنة.csv|txt`,
  a stocktake `YYYY-MM-DD/اسم الجرد.csv`, and الصلاحيات `YYYY-MM-DD/الصلاحيات.csv`. The day is
  **the field that identifies the rows**, and for الصلاحيات that is the expiry date (`ex.isoOf`),
  never `createdAt` — the folder name is the day the shelf has to be cleared. `dayOf()` uses
  `en-CA`, so the folder name sorts itself; `uniquePath()` appends ` (2)` rather than letting a
  repeated name overwrite an earlier entry.
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
  **Monospace is for machine data only** — a mono face has no Arabic shaping, so «3 ليبل» came out
  with its letters disconnected in the bottom-bar chip (caught on the live label screen 2026-07-31,
  the same failure as «فى الـنـظام» in the catalog rows). `.bottombar .count` keeps
  `font-variant-numeric: tabular-nums` and nothing else; every remaining `--mono` rule wraps digits
  or a barcode, never a word.
  **A list card carries no buttons at all** (2026-07-31, the owner's «a lot of buttons»): the card
  *is* the button (`button.card-open`, same drawn chevron as the home cards), and نسخ / Excel /
  TXT / حذف all live on the screen it opens — which is the same two taps they used to take. The
  branch filter row hides itself when the user is scoped to one branch, because a single disabled
  chip is a row that does nothing.
- **The Windows build is a window around the same files, and `preload.js` is the entire contract.**
  `desktop/main.js` serves the repo root over `http://127.0.0.1` on a random loopback port rather
  than loading `file://` — ES modules, the service worker and the Firebase SDK all behave
  differently or not at all on `file://`, and one codebase only means something if the desktop
  build runs the same code down the same paths. `scripts/desktop-check.cjs` asserts the served
  `files.js` is **byte for byte** the one the web build uses, which is what keeps that honest.
  The renderer gets no Node: `contextIsolation: true`, `nodeIntegration: false`, and `window.mart`
  is three functions over IPC. **Every path is resolved and proved to be under the root before
  anything is written** — a folder name arrives from a shipment type the shop typed, and the
  renderer is a web page. Three traversal refusals are asserted (climbing folder, climbing file
  name, absolute path). `app.whenReady` is stubbed to a never-resolving promise for the bridge
  half of the check, so no port is bound when only the handlers are being tested.
  Electron is **not** installed or run by that check — the window itself, the `.exe` and the
  install are unproven until somebody builds them on Windows.
- **The Windows build is a window around the same files, and it must stay that way.** `desktop/`
  serves the repo root over `http://127.0.0.1` on a random port rather than loading `file://`:
  ES modules, the service worker and the Firebase SDK all behave differently (or not at all) on
  `file://`, and "one codebase" has to mean the desktop build runs the same code down the same
  paths. `desktop-check.cjs` asserts the served `files.js` is **byte for byte** the web one — that
  is the check that keeps the claim true. `npm`/electron live entirely under `desktop/`, so the
  repo's no-build rule still holds for the web target.
- **`window.mart` is the whole desktop contract: `root`, `saveText`, `readText`, `listFolder`.**
  `contextIsolation: true`, `nodeIntegration: false` — the renderer never sees Node. `root` goes
  over IPC rather than reading `process.env` in the preload, because what a preload sees of
  `process` depends on whether the renderer is sandboxed, and `main.js` owns `ROOT` anyway.
  **The path guard is security, not tidiness**: a folder name arrives from a shipment type the
  shop typed into a publicly-writable settings doc, so `inside()` resolves it and proves it stayed
  under the root. Six of the 20 checks are traversal attempts.
  **`startsWith(root)` is not that check, and the served root got it wrong on the first pass**
  (caught by review, 2026-08-01): a **sibling** directory sharing the prefix passes it, so serving
  from `…/alaelah-mart` also served `…/alaelah-mart-evil`. The separator is what means "inside" —
  `p === root || p.startsWith(root + path.sep)`, the same spelling in both places.
  The reachable URL is **`/..%2f<sibling>/secret.txt`**, measured: `new URL()` decodes `%2e` and
  then normalises `/../` away, so encoded dots do nothing — the encoded **slash** is what survives
  parsing as one segment and only becomes `../` at `decodeURIComponent`, one line before the
  resolve. The first version of that check used `%2e%2e` and **passed against the broken guard**;
  a security check has to be run against the bug before it is worth anything.
  With a bridge present the admin page hides the folder picker entirely — a button that cannot
  change anything is a button that looks broken.
- **The `.exe` is a spare, not a requirement** (the owner, 2026-08-01: «the desktop means the
  laptop on the big screens the website, not application .exe»). The shop runs the WEBSITE on the
  laptop; the silent `D:\import` save there is the File System Access folder picked once from the
  admin page. Do not spend time on the installer unless that changes. The shell itself is proven:
  electron 32 is installed under `desktop/` (565 MB, lockfile committed) and
  `scratchpad/smoke-electron.mjs` opened the real window on Linux 2026-08-01, rendered the app,
  and round-tripped `window.mart.saveText`/`readText` through the path guard to a real file on
  disk. `npm run dist` has still never been run — the `.exe` is written but unbuilt.
- **A browser cannot write to `D:\` — but it can be handed a folder once.** `files.js` prefers a
  `window.mart` desktop bridge (nothing provides one yet; the preference exists so an Electron
  shell can be added without touching app code), then a File System Access directory handle the
  manager picked once from the admin page, then the download. The handle lives in **IndexedDB**,
  not localStorage — a directory handle is not JSON, it is a permission this browser holds — and
  it is per machine, never in `config/app`, the same reasoning as the camera settings.
  `usableRoot(prompt)` takes a flag because Chrome re-asks for permission once per session in some
  versions: an **export must never raise a permission dialog nobody asked for**, so only the
  settings button passes `true`; everywhere else a lost permission silently means "download".
- **A stocktake gets a TXT now, and it is still never «تم تحميلها».** `writeTxt(folder, row)` is
  the one writer: shipments go to their type's folder, a count goes to `اذن جرد`, and both use
  `shipmentText` — `barcode TAB qty`, where a count's `qty` is what was **counted on the shelf**,
  never `sys` and never the difference. `#detail-load` stays hidden for a count: downloading a
  stocktake is not taking it into the shop's system on somebody's behalf.
  **Closed with the shop 2026-08-01**: PowerTech's جرد import takes exactly two columns, كود الصنف
  and الكمية — `shipmentText`'s `barcode TAB qty` is already the right shape for both kinds.
- **The TXT folder names are mapped, never derived.** The shop writes «اذن استلام» without the
  hamza and the app's shipment types carry it (`إذن استلام`), so `TXT_FOLDER` in `manager.js` maps
  them by hand. A folder name one character off is a second folder nobody looks in. A type the
  admin adds later has no mapping and lands under its own name — better than vanishing into the
  root. **The bytes never change either way**: `barcode TAB qty`, PowerTech's shape.
- **UNVERIFIED, and it cannot be automated**: the actual disk write. `showDirectoryPicker` needs a
  real user gesture and an OS dialog, so no Playwright run can reach the disk path — the tests
  prove the names, and that a browser with no folder still falls all the way back to the download.
  Somebody has to pick `D:\import` in a real Chrome once and confirm a file lands.
- **A toast only changes colour when the code that raised it knows what it is.** `toast(msg, kind)`
  takes `ok` / `warn` / `bad`; the default is the charcoal box every one of the ~120 call sites
  already had, so nothing was swept and nothing can turn green by accident. Only the `catch`
  blocks, the `db-error` listener and the import outcomes pass a kind — the catalog import passes
  `warn` when rows were dropped and `ok` when the whole file landed, so the colour IS the summary.
  Measured 2026-07-31 with `scripts/shots-wide.mjs`: `rgb(18,133,74)` / `rgb(240,154,0)` /
  `rgb(201,48,44)`.
- **The phone column widens, the employee screens do not.** `--col` is 520px, 680px at 760px wide,
  and 1040px at 1100px **only on `body.wide`** — which `manager.html` and `admin.html` carry and
  `index.html` deliberately does not: scanning and typing do not get better wide, and the camera
  preview certainly does not. Above 1100px the manager's card lists become a grid. Measured: 2
  columns at 1440px.
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
npx playwright test                 # 88 tests, localStorage mode, ~40s
node scripts/desktop-check.cjs      # 18 checks of desktop/main.js with electron stubbed out — the
                                    # path guards and the local server, no 200 MB download needed
npx playwright test -g "catalog"    # one group
python3 -m http.server 8080         # serve locally, then open /?test=1
node scripts/make-icons.mjs         # regenerate the PWA icons
node scripts/desktop-check.cjs      # the Windows shell: path guard + the local server, with electron stubbed out (no download, no display)
cd desktop && npm install && npm start   # run the Windows build here
cd desktop && npm run dist              # build the .exe (electron-builder, output in desktop/out)
node scripts/make-xlsx-fixture.mjs  # rebuild tests/fixtures/catalog.xlsx (deflate, Excel-openable)
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
node scripts/live-junk-sweep.mjs                 # every product AND shipment a dead live run left in the real data (DELETE=1 removes them); costs one full catalog read
node scripts/live-users-probe.mjs                # read-only users list; TIME=1 also times one save ack
# price, unitCode, factor, supplierCode and «تم تحميلها» — writes, re-reads in a FRESH context,
# deletes. It tells a rules rejection from an exhausted quota: the first means the key is wrong,
# the second means the run proved NOTHING and prints INCONCLUSIVE rather than FAIL.
# BASE matters: the default is the DEPLOYED site, so a key added this session has to be checked
# against a local server (BASE=http://localhost:8080) until the push lands.
STAMP=$RANDOM BASE=http://localhost:8080 node scripts/live-newfields.mjs
node scripts/live-mobile-known.mjs               # read-only: Pixel 5 on the live site, a real catalog barcode
OUT=/tmp/shots node scripts/shot-refused.mjs     # read-only: the refusal sheet, settled, on the live site
OUT=/tmp/shots node scripts/shot-live-manager.mjs # read-only: one shot of the live manager screen
BASE=http://localhost:8087 node scripts/live-camera.mjs   # camera list/start/stop/fallback on a fake device
OUT=/tmp/shots node scripts/shots.mjs            # local screenshots (needs the server above)
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-expiry.mjs   # home + الصلاحيات screens
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-all.mjs      # all 16 screens, the visual reference set
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-dash.mjs    # the manager's daily screen: the four counters and all three ERP states, phone + 1440px. Its fixtures use MINUTE offsets on purpose — hour-scale ones run at 00:30 put "today" in yesterday and the counters look wrong when they are right
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-wide.mjs    # the ONLY check of the 1100px breakpoint and the toast colours (exits 1 if the manager list is still one column at 1440px) — shots-all.mjs is phone-width only
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-search.mjs   # the name search on all three modes
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-supplier.mjs # the supplier list, admin side and employee side
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-label.mjs    # ليبل الرف + prints 3 copies to PDF and measures the page (exits 1 if the paper is wrong)
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-manager-list.mjs # the manager list, a card screen, the stocktake tab
OUT=/tmp/shots BASE=http://localhost:8080 node scripts/shots-loaded.mjs   # the month bar, a «تم تحميلها» card and its screen, معامل التحويل on the item sheet
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
- **A seeded `createdAt` decides which month a test can see.** The list defaults to the current
  month, so a fixture stamped in the past only shows up through the empty-month fallback (that is
  why `openManagerPage()`'s 2025 timestamp still works — nothing else is seeded). A test about the
  month bar must seed one row in the current month, or it is testing the fallback instead.
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
  directly. Use it before believing any live "it worked". (The quota had reset by 2026-07-31 —
  writes land again, measured with `live-newfields.mjs` and a full `live-expiry.mjs` run.)
  **Exhausted again 2026-07-31 18:03 UTC**: `live-newfields.mjs` wrote a product and re-read
  `{"price":null,"unit":null,"factor":null}` from a fresh context, with `resource-exhausted` in the
  console — so `products.factor` and the `loadedBy`/`loadedAt` pair are **released but not yet
  proven server-side**. Re-run that script after the reset before believing they work in the shop.
  The first symptom was a live script hanging for twelve minutes on a write it awaited: a backed-off
  write does not fail, it waits.
- **Every write in the app is fire-and-forget except `saveConfig`, and that is load-bearing.**
  `markLoaded` awaited its `updateDoc` when it was first written, which put the file the manager is
  waiting for behind a server ack — twelve minutes of it while the quota was exhausted, and for
  ever offline. If a new write ever needs an ack, it needs a reason.
- **A live script that dies half way leaves its row in the real catalog.** `live-junk-sweep.mjs`
  finds them by name and, with `DELETE=1`, removes them — it reads the whole catalog because the
  catalog screen stops at 50 rows and the search index is per phone. Measured 2026-07-31 after a
  crashed run: 10,612 products and 5 shipments, **0** left behind of either. It sweeps `shipments`
  too, because a fake delivery sitting in the shop's own list is worse than a spare catalog row.
  Do not trust a screen count for this: the
  version of `live-expiry-server.mjs` that typed into the catalog search reported «50» — the first
  page, not the matches — on a catalog that had none.
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
