/**
 * The two factories: `setupI18n` wires the strategies into an `I18nRuntime` (everything
 * with a lifetime), `createI18n` derives an `I18n` facade from one (a stateless view).
 */

import { canonicalLocale } from "./locale-tags.js";
import {
  cachedDateTimeFormat,
  cachedListFormat,
  cachedNumberFormat,
  cachedRelativeTimeFormat,
} from "./intl.js";
import { defaultLocaleSource, toLocaleSource } from "./locale-source.js";
import { composePipeline } from "./pipeline.js";
import { composeSources, hasEnsure } from "./text-source.js";
import { createListeners, freeze } from "./util.js";
import type {
  I18n,
  I18nConfig,
  I18nRuntime,
  Locale,
  Namespace,
  ResolveContext,
  TextMiddleware,
  TextSource,
} from "./contracts.js";

export { createI18n, setupI18n };

/**
 * Wire the strategies into a runtime - the app-level object. Zero-config works:
 * `defaultLocaleSource()` as the locale, resolution straight to the namespace defaults.
 *
 *   const runtime = setupI18n({ textSource: defaultTextSource({ texts }) });
 *   const i18n = createI18n(runtime);
 *
 * The runtime holds everything with a lifetime: the composed source, the middlewares,
 * the merged change channel, the loading state. Facades are derived views on it and
 * can be created (and thrown away) freely.
 */
function setupI18n(config: I18nConfig = {}): I18nRuntime {
  const localeSource =
    config.localeSource === undefined ? defaultLocaleSource() : toLocaleSource(config.localeSource);
  const configured = config.textSource;
  const sources: readonly TextSource[] = !configured
    ? []
    : Array.isArray(configured)
      ? (configured as readonly TextSource[])
      : [configured as TextSource];
  const textSource = composeSources(sources);
  const middlewares: readonly TextMiddleware[] = freeze([...(config.middlewares ?? [])]);

  const listeners = createListeners();

  // The room every resolution is asked in; re-enters the full pipeline. Translation
  // functions get the same cached siblings `withLocale` hands out - a dynamic default is
  // invoked on EVERY resolution, so a fresh facade per call would be wasteful here.
  const context: ResolveContext = freeze({
    localize: (locale: Locale): I18n => boundSibling(runtime, locale),
  });
  const runPipeline = composePipeline(textSource, middlewares, context);

  // Bridge BOTH strategies' change channels into the shared listener set.
  localeSource.onChange?.(listeners.notify); // locale changed
  textSource?.onChange?.(listeners.notify); // texts changed (e.g. async resources arrived)

  const runtime: I18nRuntime = freeze({
    currentLocale: () => localeSource.getLocale(),
    onChange: listeners.add,

    resolveText: (namespace, key, params, locale) =>
      runPipeline(freeze({ locale, namespace, key, params })),

    hasText: (namespace, key, locale, includeFallback) => {
      // Source-only: bypass fallback combinators and defaults.
      if (!includeFallback) return textSource?.resolveExact?.(locale, namespace, key) !== undefined;
      // Full pipeline, with `params: null` so no translation function is invoked.
      if (runPipeline(freeze({ locale, namespace, key, params: null })) !== undefined) return true;
      // A key whose default is a translation function is answered by neither - the
      // pipeline skips it without params. It exists nonetheless, so say so.
      return Object.hasOwn(namespace.defaults, key);
    },

    ensureTexts: (namespaces, locale) => {
      if (!textSource || !hasEnsure(textSource)) return undefined; // no loading capability
      const pending = namespaces
        .map((namespace) => textSource.ensure(locale, namespace))
        .filter((promise): promise is Promise<void> => promise !== undefined);
      return pending.length ? Promise.all(pending).then(() => undefined) : undefined;
    },
  });

  return runtime;
}

// # The facade factory ------------------------------------------------------------------

/**
 * Derive an I18n facade from a runtime. Without a locale the facade is DYNAMIC (it
 * follows the runtime's LocaleSource); with one it is statically bound to that tag -
 * what `withLocale` hands out, and what a per-request render on a server wants.
 *
 * Facades are stateless views: creating one allocates a plain object and nothing else,
 * so a binding may mint a fresh one per change to signal "something changed" by
 * identity. Everything they touch lives on the shared runtime.
 *
 * `createI18n` therefore always CREATES - the fresh identity is the point. `withLocale`
 * on the result is the accessor twin: it hands out memoized siblings (see
 * `boundSibling`), so `i18n.withLocale("fr") === i18n.withLocale("fr")` and a repeated
 * call in render code allocates nothing.
 */
function createI18n(runtime: I18nRuntime, locale?: Locale): I18n {
  const getLocale = locale === undefined ? () => runtime.currentLocale() : () => locale;

  // Facade-owned miss policy: `undefined` from the pipeline -> the key itself.
  // (`??`, not `||`: an empty string is a valid translation.) With defaults on the
  // namespace, the bare key only ever appears for keys that have no default -
  // which the `text` overloads rule out at compile time.
  const text: I18n["text"] = (namespace: any, key: any, params?: any) =>
    runtime.resolveText(namespace, key as string, params, getLocale()) ?? (key as string);

  const hasText: I18n["hasText"] = (namespace, key, includeFallback = false) =>
    runtime.hasText(namespace, key as string, getLocale(), includeFallback);

  const bindTexts: I18n["bindTexts"] = (boundNs?: Namespace<any>) => {
    const lookup = text as (ns: any, key: any, params?: any) => string;
    return (a: unknown, b?: unknown, c?: unknown): string =>
      boundNs && typeof a === "string" ? lookup(boundNs, a, b) : lookup(a, b, c);
  };

  return freeze({
    text,
    hasText,
    bindTexts,
    formatNumber: (value, options?) => cachedNumberFormat(getLocale(), options).format(value),
    formatNumberRange: (start, end, options?) =>
      cachedNumberFormat(getLocale(), options).formatRange(start, end),
    numberFormat: (options) => cachedNumberFormat(getLocale(), options),
    formatDateTime: (value, options) => cachedDateTimeFormat(getLocale(), options).format(value),
    formatDateTimeRange: (start, end, options?) =>
      cachedDateTimeFormat(getLocale(), options).formatRange(start, end),
    dateTimeFormat: (options) => cachedDateTimeFormat(getLocale(), options),
    formatRelativeTime: (value, unit, options?) =>
      cachedRelativeTimeFormat(getLocale(), options).format(value, unit),
    relativeTimeFormat: (options) => cachedRelativeTimeFormat(getLocale(), options),
    formatList: (list, options?) => cachedListFormat(getLocale(), options).format(list),
    listFormat: (options) => cachedListFormat(getLocale(), options),
    locale: () => getLocale(),
    withLocale: (target: Locale) => boundSibling(runtime, target),
  });
}

// Memoized locale-bound siblings, per runtime. Facades are stateless views, so sharing
// one per (runtime, tag) is semantically invisible - exactly like the Intl formatter
// cache - and keeps `withLocale` identity-stable for dependency arrays and memo
// comparisons. Keyed by CANONICAL tag, so "en-us" and "en-US" share a sibling, but bound
// to the tag as passed: formatters must see any unicode extensions the caller wrote.
// Weak on the runtime, so a discarded runtime takes its siblings with it.
const siblings = new WeakMap<I18nRuntime, Map<string, I18n>>();

function boundSibling(runtime: I18nRuntime, locale: Locale): I18n {
  let byTag = siblings.get(runtime);
  if (!byTag) {
    byTag = new Map<string, I18n>();
    siblings.set(runtime, byTag);
  }
  const cacheKey = canonicalLocale(locale);
  let sibling = byTag.get(cacheKey);
  if (!sibling) {
    sibling = createI18n(runtime, locale);
    byTag.set(cacheKey, sibling);
  }
  return sibling;
}
