# Shipment Intake PWA — Design Spec

**Date:** 2026-07-28
**Project:** alaelah-mart — supermarket shipment intake app
**Status:** Approved by user (approach A: static PWA + Firebase Firestore)

## Problem

Supermarket employees receive supplier shipments and record them on paper. Owner
(manager) wants a free phone-friendly app: employees create a shipment, scan each
item's barcode with the camera, enter quantity; manager sees all shipments in one
place and can copy any shipment as plain text.

## Constraints

- Free hosting, free data storage, nothing to maintain.
- Works on employees' own Android phones via browser (PWA, installable).
- Arabic-only UI, RTL.
- Store wifi unreliable → must work offline and sync later.
- Trusted small staff → no real accounts.

## Architecture

- Vanilla HTML/JS/CSS single-page app. No framework, no build step.
- Files: `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`, vendored
  scanner lib.
- Scanner: `html5-qrcode` (reads EAN-13, EAN-8, Code 128, QR). Vendored locally —
  no runtime CDN dependency.
- Data: Firebase Firestore via JS SDK, ESM import from the official gstatic CDN
  (standard Firebase pattern; sw.js does not cache it — Firestore has its own
  offline layer). Offline persistence enabled.
- Hosting: GitHub Pages (HTTPS included — required for camera API).

## Data model (Firestore)

| Collection | Document | Fields |
|---|---|---|
| `shipments` | auto-id | `name` (string), `createdBy` (string), `createdAt` (timestamp), `items` (array of `{barcode, name, qty}`) |
| `products` | doc id = barcode | `name` (string) — shared catalog, first employee to name a barcode names it for everyone |

One shipment = one document. No subcollections, no joins, no pagination (single
store volume is small).

## Screens (Arabic, RTL)

1. **First open** — employee types their name once; stored in `localStorage`.
2. **Home** — «شحنة جديدة» button + list of shipments created by this device's
   user; link to manager view.
3. **New shipment** — shipment name field → scan button opens camera → on
   successful read: if barcode exists in `products`, item name auto-fills; else
   employee types name (saved to `products`) → quantity input (default 1, +/−
   buttons) → item appended to list → continue scanning. «حفظ» saves the
   shipment document.
4. **Manager view** — behind 4-digit PIN (constant in code, client-side gate
   only). Lists all shipments newest-first. Tap shipment → items table +
   «نسخ كنص» button copying plain text: header line (shipment name, employee,
   date) then one line per item: `<item name> <qty>`.

## Offline / PWA

- `sw.js` caches the app shell → app opens with no network.
- Firestore offline persistence → shipments created offline sync automatically
  when connection returns.
- Sync indicator in UI: «متزامن» / «في انتظار الاتصال».
- `manifest.json` → installable to homescreen with icon.

## Security (accepted trade-off)

Firestore security rules allow public read/write on the two collections because
there is no authentication. The manager PIN is a client-side UI gate only, not
real security. Acceptable for a trusted small staff; the app URL must not be
shared publicly. Upgrade path if ever needed: Firebase Auth (email or phone) +
rules restricting writes — no rebuild required.

Mitigations included anyway:
- Firestore rules validate document shape (field types, max items array length,
  max string lengths) to block garbage/abuse writes.
- No sensitive data stored (item names and quantities only).

## Error handling

- Camera permission denied or no camera → manual barcode text input (also covers
  damaged barcodes).
- Same barcode scanned twice in one shipment → increment qty, no duplicate row.
- Save failure surfaces a visible Arabic error; data stays local until synced.

## Testing

- One Playwright smoke test (desktop, Firestore emulator or test project):
  create shipment via manual barcode entry → appears in manager list → copy text
  matches expected format.
- Camera scanning verified manually on a real phone.

## One-time setup required from owner

Create Firebase project (free Spark plan), enable Firestore, paste web app
config into `app.js`, deploy rules. ~15 minutes, guided.

## Out of scope (YAGNI)

Accounts/roles, editing saved shipments, product prices, stock levels, reports,
multi-store, iOS-specific work (PWA works on iOS Safari but primary target is
Android), notifications.
