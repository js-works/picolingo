/**
 * The authoring API, used by component and translation authors: namespaces with their
 * default texts, bundles of translations per locale, and catalogs that declare what
 * exists and how to load it. `checkTexts` is the runtime twin of the compile-time
 * checks, so plain-JS callers get the same guarantees.
 */

import { checkLocaleTags, freeze } from "./util.js";
import type {
  Locale,
  Namespace,
  NamespaceTexts,
  TextBundle,
  TextCatalog,
  TextMap,
  TextsOf,
} from "./contracts.js";

export { allTexts, bundleTexts, createNamespace, someTexts, textCatalog };

/**
 * Validate a translation against its namespace's defaults - the runtime twin of the
 * compile-time checks, so plain-JS callers get the same guarantees and TypeScript
 * callers get a readable error at the declaration site. Reports (all at once, in one
 * TypeError): keys absent from the defaults, values whose kind disagrees with the
 * default (string vs. function), and - when `full` - missing keys. An explicit
 * `undefined` counts as "not provided", matching the store, which skips it.
 */
function checkTexts(
  fn: string,
  namespace: Namespace<any>,
  texts: Record<string, unknown>,
  full: boolean,
): void {
  const quote = (keys: string[]) =>
    keys
      .sort()
      .map((key) => `"${key}"`)
      .join(", ");
  const defaults = namespace.defaults as Record<string, unknown>;
  const given = Object.keys(texts).filter((key) => texts[key] !== undefined);
  const issues: string[] = [];

  const unknown = given.filter((key) => !Object.hasOwn(defaults, key));
  if (unknown.length) issues.push(`unknown keys [${quote(unknown)}]`);

  const mismatched = given
    .filter((key) => Object.hasOwn(defaults, key) && typeof texts[key] !== typeof defaults[key])
    .map((key) => `"${key}" (expected ${typeof defaults[key]}, got ${typeof texts[key]})`);
  if (mismatched.length) issues.push(`kind mismatches [${mismatched.sort().join(", ")}]`);

  if (full) {
    const missing = Object.keys(defaults).filter((key) => texts[key] === undefined);
    if (missing.length) issues.push(`missing keys [${quote(missing)}]`);
  }

  if (issues.length)
    throw new TypeError(`i18n: ${fn} for namespace "${namespace.key}": ${issues.join("; ")}`);
}

/**
 * Create a namespace from its default texts. The defaults define the namespace's
 * shape (keys + param types) AND serve as the resolution terminal - a component
 * library shipping a namespace works without any app cooperation. Namespaces are pure
 * data; texts for other locales are attached with the freestanding `allTexts`/`someTexts`.
 */
function createNamespace<T extends TextMap>(params: { key: string; defaults: T }): Namespace<T> {
  return freeze({ key: params.key, defaults: freeze({ ...params.defaults }) });
}

/**
 * Type-safe identity for a standalone-declared TextBundle: errors surface at the
 * declaration site (with precise key/param locations) instead of at a distant
 * consumer. Not needed when passing a literal to `defaultTextSource` directly.
 */
function bundleTexts<T extends TextBundle>(texts: T): TextBundle {
  return texts;
}

/** Attach texts for one locale - partial (missing keys fall back to the defaults). */
function someTexts<T extends TextMap>(
  namespace: Namespace<T>,
  texts: TextsOf<T>,
): NamespaceTexts<T> {
  checkTexts("someTexts", namespace, texts as Record<string, unknown>, false);
  return freeze({ namespace, texts });
}

/** Like `someTexts`, but every key must be present (checked at compile time AND runtime). */
function allTexts<T extends TextMap>(
  namespace: Namespace<T>,
  texts: Required<TextsOf<T>>,
): NamespaceTexts<T> {
  checkTexts("allTexts", namespace, texts as Record<string, unknown>, true);
  return freeze({ namespace, texts });
}

// # Catalogs -------------------------------------------------------------------------

// A per-locale loader. The module form (`() => import("./de.js")`) is accepted directly:
// the default export is unwrapped, so entries need no `.then(m => m.default)`.
type BundleLoader = () => TextBundle | Promise<TextBundle | { default: TextBundle }>;

type TextCatalogInput =
  | Readonly<{
      namespaces: readonly Namespace<any>[];
      // Keys are the locales this catalog serves - one static `import()` per entry, so
      // every bundler can resolve and code-split them. Also the coverage declaration:
      // there is no separate locale list to drift from what actually exists.
      bundles: Readonly<Record<Locale, BundleLoader>>;
    }>
  | Readonly<{
      namespaces: readonly Namespace<any>[];
      // For texts that are not files (a backend, a CMS): the locale list must be declared.
      locales: readonly Locale[];
      load(locale: Locale): TextBundle | Promise<TextBundle | undefined> | undefined;
    }>;

/** Unwrap a module namespace, so `() => import("./de.js")` works without ceremony. */
function unwrapBundle(
  value: TextBundle | { default: TextBundle } | undefined,
): TextBundle | undefined {
  if (!value) return undefined;
  return (value as { default?: TextBundle }).default ?? (value as TextBundle);
}

/**
 * Declare a lazy, scoped contribution of translations: WHICH namespaces and locales it
 * can serve, and HOW to load one. Exported by whoever owns the texts - a component
 * library for its own components, an app for its own screens - and simply listed in
 * `defaultTextSource({ texts })`, wherever it came from.
 *
 * The declaration is readable data, which is what makes `textCoverage` possible: a gap
 * is visible without loading anything, and without anyone reading a README.
 *
 *   textCatalog({
 *     namespaces: [datePickerTexts, calendarTexts],
 *     bundles: { de: () => import("./locales/de.js"), fr: () => import("./locales/fr.js") },
 *   })
 *
 * Invalid locale tags fail loudly here, at setup - not at the first miss.
 */
function textCatalog(input: TextCatalogInput): TextCatalog {
  const namespaces = freeze([...input.namespaces]);

  if ("bundles" in input) {
    const { bundles } = input;
    const locales = freeze(Object.keys(bundles));
    checkLocaleTags(locales);
    return freeze({
      namespaces,
      locales,
      load: async (locale: Locale) => unwrapBundle(await bundles[locale]?.()),
    });
  }

  const locales = freeze([...input.locales]);
  checkLocaleTags(locales);
  return freeze({ namespaces, locales, load: input.load });
}
