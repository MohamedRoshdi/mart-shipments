/* The one place the release is named. Every page prints it in its footer, so a person looking at
   a phone can tell you which build they are on without opening anything.

   BUILD is a literal, never `new Date()`: a date computed at render time prints the day the page
   was opened, which looks like a version number and is not one. Bump both here in the same edit
   that bumps CACHE in sw.js — a footer that lags the cache is worse than no footer. */
export const APP_NAME = "العائلة مارت";
export const VERSION = "1.0.92";      // the number after the dot is the sw.js CACHE generation
export const BUILD = "03-08-2026";

/* `?test=1` writes to the phone and NOWHERE else — which looks exactly like a device whose work
   never reaches the others, and it is invisible: same screens, same version, same everything. A
   shortcut saved from a test link would keep a phone in it for ever, so the footer says so. It is
   the footer and not the sync chip because the footer is already the thing people are asked to
   read off a phone, and because the chip is about the network, not about which database this is. */
export const versionLine = () => `${APP_NAME} | Version ${VERSION} | Build ${BUILD}`
  + (new URLSearchParams(location.search).has("test") ? " | وضع تجربة — مفيش حفظ حقيقي" : "");
