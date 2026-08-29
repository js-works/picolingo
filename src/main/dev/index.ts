/**
 * Development and CI tooling. Separate entry point (`picolingo/dev`) on purpose: none
 * of it belongs in a production bundle, and the import path says so at the call site.
 *
 * Two complementary answers to "which text is not translated?":
 *
 *   - `reportTextMisses` - at RUNTIME, key-exact. Reports every resolution that falls
 *     through to a default or to the bare key, while you click through the app. Finds
 *     single missing keys and mistyped keys; blind to pages nobody opened.
 *   - `textCoverage` - AHEAD of time, namespace-exact by default. Reads the declarations
 *     and reports whole gaps without rendering anything, so a dependency update that
 *     adds a namespace or drops a language turns a CI test red. Pass `{ load: true }`
 *     to actually fetch everything and get key-exact results.
 */

import { buildLanguageTagChain, normalizeLocale } from "../core/locale-tags.js";
import type {
  Locale,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  TextBundle,
  TextCatalog,
  TextInput,
  TextKey,
  TextMiddleware,
} from "../core/index.js";

export { reportTextMisses, textCoverage };
export type { TextCoverage, TextCoverageGap, TextCoverageOptions, ReportTextMissesOptions };

// -------------------------------------------------------------------
// # Coverage
// -------------------------------------------------------------------

type TextCoverageGap = Readonly<{
  namespace: NamespaceKey;
  locale: Locale;
  // Only in `{ load: true }` mode, and only for a PARTIAL gap: the keys that are
  // missing from an otherwise present translation. Absent when nothing at all covers
  // the pair.
  keys?: readonly TextKey[];
}>;

type TextCoverage = Readonly<{
  missing: readonly TextCoverageGap[];
  covered: readonly Readonly<{ namespace: NamespaceKey; locale: Locale }>[];
}>;

type TextCoverageOptions = Readonly<{
  // Actually run every catalog's loader and compare the loaded keys against each
  // namespace's defaults - exact, but it does real I/O. Meant for tests, not for a
  // request path.
  load?: boolean;
}>;

/** What one contribution provides: normalized tag -> namespace key -> the keys it holds. */
type Contribution = Map<string, Map<NamespaceKey, Set<TextKey>>>;

function isCatalog(input: TextInput): input is TextCatalog {
  const candidate = input as Partial<TextCatalog>;
  return typeof candidate.load === "function" && Array.isArray(candidate.namespaces);
}

function recordBundle(into: Contribution, bundle: TextBundle): void {
  for (const rawLocale of Object.keys(bundle)) {
    const tag = normalizeLocale(rawLocale);
    const perNamespace = into.get(tag) ?? new Map<NamespaceKey, Set<TextKey>>();
    into.set(tag, perNamespace);
    const entry = bundle[rawLocale];
    for (const { namespace, texts } of (Array.isArray(entry)
      ? entry
      : [entry]) as NamespaceTexts<any>[]) {
      const keys = perNamespace.get(namespace.key) ?? new Set<TextKey>();
      perNamespace.set(namespace.key, keys);
      for (const [key, value] of Object.entries(texts as Record<string, unknown>)) {
        if (value !== undefined) keys.add(key);
      }
    }
  }
}

/** Record what a catalog CLAIMS: the declared cross product, with unknown keys. */
function recordCatalogDeclaration(into: Contribution, catalog: TextCatalog): void {
  for (const rawLocale of catalog.locales) {
    const tag = normalizeLocale(rawLocale);
    const perNamespace = into.get(tag) ?? new Map<NamespaceKey, Set<TextKey>>();
    into.set(tag, perNamespace);
    for (const namespace of catalog.namespaces) {
      if (!perNamespace.has(namespace.key)) perNamespace.set(namespace.key, new Set());
    }
  }
}

/** The keys a contribution holds for a pair, following the within-language chain. */
function keysFor(
  contribution: Contribution,
  locale: Locale,
  namespace: Namespace<any>,
): Set<TextKey> | undefined {
  for (const tag of buildLanguageTagChain(locale)) {
    const keys = contribution.get(tag)?.get(namespace.key);
    if (keys) return keys;
  }
  return undefined;
}

function textCoverage(
  texts: readonly TextInput[],
  locales: readonly Locale[],
  namespaces: readonly Namespace<any>[],
): TextCoverage;
function textCoverage(
  texts: readonly TextInput[],
  locales: readonly Locale[],
  namespaces: readonly Namespace<any>[],
  options: TextCoverageOptions & { load: true },
): Promise<TextCoverage>;
/**
 * Report which of `namespaces` lack a translation in which of `locales`.
 *
 *   const { missing } = textCoverage(texts, ["de", "fr"], [cartTexts, datePickerTexts]);
 *   expect(missing).toEqual([]);
 *
 * `namespaces` is REQUIRED, and that is deliberate: without it the report could only
 * check namespaces that somebody already translated, so a component nobody ever
 * localized would pass silently - the one case you most want to hear about. The list is
 * an inventory the app maintains; forget an entry and that namespace goes unchecked.
 *
 * Reads declarations only and loads nothing, so a `Promise` entry in `texts` cannot be
 * inspected and is ignored. With `{ load: true }` every catalog and promise IS resolved
 * and the loaded keys are compared against each namespace's defaults, which also makes
 * the report key-exact.
 */
function textCoverage(
  texts: readonly TextInput[],
  locales: readonly Locale[],
  namespaces: readonly Namespace<any>[],
  options: TextCoverageOptions = {},
): TextCoverage | Promise<TextCoverage> {
  const contribution: Contribution = new Map();

  if (!options.load) {
    for (const input of texts) {
      if (isCatalog(input)) recordCatalogDeclaration(contribution, input);
      else if (!(input instanceof Promise)) recordBundle(contribution, input);
    }
    return summarize(contribution, locales, namespaces, false);
  }

  return (async () => {
    for (const input of texts) {
      if (isCatalog(input)) {
        for (const locale of locales) {
          const declared = new Set(input.locales.map(normalizeLocale));
          const tag = buildLanguageTagChain(locale).find((candidate) => declared.has(candidate));
          if (tag) recordBundle(contribution, (await input.load(tag)) ?? {});
        }
      } else {
        recordBundle(contribution, input instanceof Promise ? await input : input);
      }
    }
    return summarize(contribution, locales, namespaces, true);
  })();
}

function summarize(
  contribution: Contribution,
  locales: readonly Locale[],
  namespaces: readonly Namespace<any>[],
  keyExact: boolean,
): TextCoverage {
  const missing: TextCoverageGap[] = [];
  const covered: { namespace: NamespaceKey; locale: Locale }[] = [];

  for (const namespace of namespaces) {
    for (const locale of locales) {
      const keys = keysFor(contribution, locale, namespace);
      if (!keys) {
        missing.push(Object.freeze({ namespace: namespace.key, locale }));
        continue;
      }
      const absent = keyExact
        ? Object.keys(namespace.defaults).filter((key) => !keys.has(key))
        : [];
      if (absent.length) {
        missing.push(
          Object.freeze({ namespace: namespace.key, locale, keys: Object.freeze(absent) }),
        );
      } else {
        covered.push(Object.freeze({ namespace: namespace.key, locale }));
      }
    }
  }

  return Object.freeze({ missing: Object.freeze(missing), covered: Object.freeze(covered) });
}

// -------------------------------------------------------------------
// # Miss reporting
// -------------------------------------------------------------------

type ReportTextMissesOptions = Readonly<{
  // Where to write. Default: `console.warn`.
  log?: (message: string) => void;
}>;

/**
 * A middleware that reports every resolution which did NOT come from a real translation
 * - while you use the app, in the locale you are actually looking at:
 *
 *   setupI18n({
 *     textSource,
 *     middlewares: import.meta.env.DEV ? [reportTextMisses()] : [],
 *   });
 *
 *   i18n: "cancel" (common) has no translation for "fr" - using the default
 *   i18n: "vatNotice" (checkout) fell through to the bare key - no translation, no default
 *
 * Each (locale, namespace, key) is reported ONCE, so a re-render does not spam the
 * console. A consequence worth knowing: a text reported before its bundle finished
 * loading stays reported, even though the translation shows up moments later.
 *
 * "No translation" means no hit for the ACTIVE locale (`hasText`, which does not look at
 * fallback locales), so a text served by a fallback language is reported too - which is
 * usually what you want to see.
 */
function reportTextMisses(options: ReportTextMissesOptions = {}): TextMiddleware {
  const log = options.log ?? ((message: string) => console.warn(message));
  const reported = new Set<string>();

  return (request, context, next) => {
    const result = next();
    const id = `${request.locale}${request.namespace.key}${request.key}`;
    if (reported.has(id)) return result;

    const where = `"${request.key}" (${request.namespace.key})`;
    if (result === undefined) {
      reported.add(id);
      log(`i18n: ${where} fell through to the bare key - no translation, no default`);
    } else if (!context.localize(request.locale).hasText(request.namespace, request.key)) {
      reported.add(id);
      log(`i18n: ${where} has no translation for "${request.locale}" - using the default`);
    }
    return result;
  };
}
