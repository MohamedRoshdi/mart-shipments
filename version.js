/* The one place the release is named. Every page prints it in its footer, so a person looking at
   a phone can tell you which build they are on without opening anything.

   BUILD is a literal, never `new Date()`: a date computed at render time prints the day the page
   was opened, which looks like a version number and is not one. Bump both here in the same edit
   that bumps CACHE in sw.js — a footer that lags the cache is worse than no footer. */
export const APP_NAME = "العائلة مارت";
export const VERSION = "1.0.63";      // the number after the dot is the sw.js CACHE generation
export const BUILD = "01-08-2026";

export const versionLine = () => `${APP_NAME} | Version ${VERSION} | Build ${BUILD}`;
