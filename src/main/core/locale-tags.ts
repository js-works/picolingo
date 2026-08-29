/**
 * Tag matching: how a requested locale narrows to what a store actually holds. Used by
 * the store and by `dev/textCoverage`, which must report on exactly these rules rather
 * than a second implementation that would drift from them.
 *
 * `index.ts` does not re-export this module, so none of it is public API.
 */

import type { Locale } from "./contracts.js";

export { buildLanguageTagChain, canonicalLocale, normalizeLocale };

/** Project a parsed tag; on an invalid one (parsing throws) return the raw input. */
function parseLocale(locale: Locale, project: (loc: Intl.Locale) => string): string {
  try {
    return project(new Intl.Locale(locale));
  } catch {
    return locale;
  }
}

/** Storage/de-dup identity: `baseName` (case-normalized, extensions dropped). */
function normalizeLocale(locale: Locale): string {
  return parseLocale(locale, (loc) => loc.baseName);
}

/**
 * Instance-cache identity: the FULL tag case-normalized, extensions preserved -
 * "en-US-u-nu-arab" and "en-US" format differently and must not share a facade.
 */
function canonicalLocale(locale: Locale): string {
  return parseLocale(locale, (loc) => loc.toString());
}

/**
 * Ordered, de-duplicated chain of normalized tags, most -> least specific, WITHIN the
 * requested language: "de-CH" -> ["de-CH", "de"], "zh-Hant-TW" -> ["zh-Hant-TW",
 * "zh-TW", "zh"]. An invalid tag does NOT throw - it degrades to one opaque candidate
 * that misses the (normalized) store, so a bad requested locale (e.g. a malformed
 * `<html lang>`) falls through to the namespace defaults instead of crashing every
 * lookup. Cross-LANGUAGE fallback is not a store concern - see `withFallbackLocales`.
 */
function buildLanguageTagChain(locale: Locale): Locale[] {
  let loc: Intl.Locale;
  try {
    loc = new Intl.Locale(locale);
  } catch {
    return [locale];
  }
  const tags = [loc.baseName]; // canonical full tag first
  // "<language>-<region>" beats the bare language; a NEW tag only with a script subtag.
  if (loc.language && loc.region) tags.push(`${loc.language}-${loc.region}`);
  if (loc.language) tags.push(loc.language);
  return [...new Set(tags.map(normalizeLocale))];
}
