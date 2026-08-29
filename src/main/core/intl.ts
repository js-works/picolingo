/**
 * The fixed Intl core - the one deliberately non-configurable part of the library.
 * Formatters depend only on (kind, locale, options), so they are cached and shared
 * across every facade.
 */

import type { Locale } from "./contracts.js";

export { cachedDateTimeFormat, cachedListFormat, cachedNumberFormat, cachedRelativeTimeFormat };

// Formatters depend ONLY on (kind, locale, options) - deterministic, so sharing them
// across all I18n instances is safe and semantically invisible. Unbounded by design:
// real apps use a handful of option shapes and locales. (Programmatically generated
// option values - e.g. `minimumFractionDigits: i` in a loop - would grow it; don't.)
const formatterCache = new Map<
  string,
  Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.ListFormat
>();

/** JSON with sorted keys, so semantically equal option objects share a cache entry. */
function stableStringify(options?: object): string {
  if (!options) return "";
  const record = options as Record<string, unknown>;
  return JSON.stringify(
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]]),
  );
}

function cachedFormatter<
  F extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.ListFormat,
>(kind: "n" | "d" | "r" | "l", locale: Locale, options: object | undefined, create: () => F): F {
  const cacheKey = `${kind}\u0001${locale}\u0001${stableStringify(options)}`;
  let format = formatterCache.get(cacheKey) as F | undefined;
  if (!format) {
    format = create();
    formatterCache.set(cacheKey, format);
  }
  return format;
}

function cachedNumberFormat(locale: Locale, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cachedFormatter("n", locale, options, () => new Intl.NumberFormat(locale, options));
}

function cachedDateTimeFormat(
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return cachedFormatter("d", locale, options, () => new Intl.DateTimeFormat(locale, options));
}

function cachedRelativeTimeFormat(
  locale: Locale,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cachedFormatter("r", locale, options, () => new Intl.RelativeTimeFormat(locale, options));
}

function cachedListFormat(locale: Locale, options?: Intl.ListFormatOptions): Intl.ListFormat {
  return cachedFormatter("l", locale, options, () => new Intl.ListFormat(locale, options));
}
