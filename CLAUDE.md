# mart-shipments — working notes for Claude

Shipment-intake PWA for a two-branch Egyptian supermarket. Employees scan barcodes
into a shipment on their phones; a manager page reviews, edits, exports and manages
the product catalog. Arabic-only UI, RTL, offline-capable, free to run.

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
   keep the old bundle until the cache name changes. Currently `mart-v14`.
7. **Deploy = push to master.** GitHub Pages serves the repo root. Firestore rules
   deploy separately: `npx firebase deploy --only firestore:rules --project shipments-alaela-mart`.

## Layout

| File | Role |
|---|---|
| `index.html` / `app.js` | employee app: setup, home, new/edit shipment, camera, item sheet |
| `manager.html` / `manager.js` | manager app: PIN, shipment list, shipment edit, catalog screen, import/export |
| `db.js` | data layer; `?test=1` switches the whole app to localStorage |
| `style.css` | one stylesheet for both pages |
| `sw.js`, `manifest.json`, `manifest-manager.json` | two installable PWAs (employee + manager) |
| `firebase-config.js` | Firebase keys **plus** `APP_CONFIG`: PINs, branches, shipment types |
| `firestore.rules` | shape validation; the only server-side guard that exists |
| `SETUP.md` | Arabic guide for the shop owner |
| `tests/app.spec.js` | 22 Playwright tests, all in localStorage mode |
| `scripts/*.mjs` | live checks and screenshot helpers (see below) |

## Data model

`shipments/{auto}` — `name`, `createdBy`, `createdAt` (epoch ms), `branch`, `type`,
`items: [{barcode, name, qty}]`.

`products/{barcode}` — `{ name }`. The barcode **is** the document id.

Rules in force (all live-tested):
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
- **Branch is chosen once per phone** and requires the branch PIN, at setup and on
  every change. Shipments carry that branch; the manager cannot move a shipment
  between branches.
- **Manager scope:** logging in with a branch PIN filters the list *before* render
  and disables the branch chip. Only the master PIN sees every branch.
- Catalog screen loads `PRODUCT_CAP = 300` rows; search is **server-side prefix**
  on name and on document id (50 hits each). Prefix, not substring. `countProducts()`
  gives the honest total. Export uses `listAllProducts()` — one deliberate full read.

## Commands

```bash
npx playwright test                 # 22 tests, localStorage mode, ~10s
npx playwright test -g "catalog"    # one group
python3 -m http.server 8080         # serve locally, then open /?test=1
node scripts/make-icons.mjs         # regenerate the PWA icons
```

Live checks against **production Firestore** (each cleans up after itself):

```bash
STAMP=$RANDOM node scripts/live-check.mjs        # employee → manager full loop
STAMP=$RANDOM node scripts/live-mobile.mjs       # same, Pixel 5 emulation + PWA signals
STAMP=$RANDOM node scripts/live-products.mjs     # catalog: import, rename, delete
node scripts/live-search-name.mjs                # proves search reaches past the loaded page
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

## Deployment facts

- App: https://mohamedroshdi.github.io/mart-shipments/
- Manager: https://mohamedroshdi.github.io/mart-shipments/manager.html
- Repo: https://github.com/MohamedRoshdi/mart-shipments (public — the URL is the
  only real protection; PINs are client-side gates, not security)
- Firebase project `shipments-alaela-mart`, Firestore `(default)` in `eur3`,
  free Spark plan. Catalog measured 2026-07-30: **10,043 products**.
- Pages builds take a few minutes and the builds API lags; verify with a
  cache-busted `curl` of the changed file instead of trusting the API status.

## Known limits (accepted, not bugs)

- No auth. Anyone with the URL can read, write and delete. Rules only validate shape.
- Catalog search matches the **start** of a name; mid-word search needs a search service.
- The sync chip reports connectivity (`navigator.onLine`), not real sync state.
- Camera scanning can only be verified on a physical phone.
