/**
 * The `.` entry point: everything the core makes public, and nothing else. Each export
 * lives in the module named beside it.
 *
 * The types come across wholesale: `contracts.ts` exports exactly the public surface, so a
 * second list here could only drift from it. A type two core modules need but consumers
 * do not is derived where it is used, never added to `contracts.ts`.
 *
 * The design behind this - the runtime/facade split, the three strategies, the
 * resolution order, what belongs in which module - is written down once, in
 * ARCHITECTURE.md at the repository root.
 */

export { allTexts, bundleTexts, createNamespace, someTexts, textCatalog } from "./namespaces.js";
export { defaultLocaleSource } from "./locale-source.js";
export { defaultTextSource } from "./text-source.js";
export { createI18n, setupI18n } from "./runtime.js";

export type * from "./contracts.js";
