/** The release this copy of the app was built from (scripts/version.ts). */
declare const __LIGHTKONE_VERSION__: { version: string; commit: string; date: string; label: string };

export const BUILD = typeof __LIGHTKONE_VERSION__ === "undefined" ? { version: "", commit: "", date: "", label: "dev" } : __LIGHTKONE_VERSION__;
