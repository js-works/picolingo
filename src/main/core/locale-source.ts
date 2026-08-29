/**
 * The default LocaleSource: the client-side `<html lang>` monitor, and the server-side
 * forms (a fixed tag, a getter, or a full source with its own change channel).
 */

import { createListeners, freeze } from "./util.js";
import type { Locale, LocaleSource } from "./contracts.js";

export { defaultLocaleSource, toLocaleSource };

/** We are in the browser or a fake testing browser. */
function isClientSide(g = globalThis): boolean {
  return !!g.window?.MutationObserver && !!g.document?.documentElement;
}

/**
 * The client-side locale source: `getLocale` reads the live `<html lang>` attribute
 * (falling back to `defaultLocale` when absent); `onChange` is driven by a
 * MutationObserver on it.
 */
function createDocumentLangMonitor(defaultLocale: Locale, g = globalThis): LocaleSource {
  const listeners = createListeners();
  new g.MutationObserver(listeners.notify).observe(g.document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return freeze({
    getLocale: () => g.document.documentElement.getAttribute("lang") ?? defaultLocale,
    onChange: listeners.add,
  });
}

/** Accept the shorthand forms of a locale source: a fixed tag or a plain getter. */
function toLocaleSource(input: Locale | (() => Locale) | LocaleSource): LocaleSource {
  if (typeof input === "string") return freeze({ getLocale: () => input });
  return typeof input === "function" ? freeze({ getLocale: input }) : input;
}

/**
 * The default LocaleSource - also used by `setupI18n` when none is configured. On
 * the client: the `<html lang>` monitor (not configurable - a client app wanting
 * something else writes its own LocaleSource). Elsewhere (no DOM): `serverSide`,
 * accepted as a fixed tag (SSG), a getter (e.g. per-request via AsyncLocalStorage),
 * or a full LocaleSource (own change channel). `defaultLocale` (default "en-US")
 * answers when nothing is detectable: the `lang` attribute is absent (client) or no
 * `serverSide` was given (elsewhere).
 */
function defaultLocaleSource(
  options: Readonly<{
    defaultLocale?: Locale;
    serverSide?: Locale | (() => Locale) | LocaleSource;
  }> = {},
): LocaleSource {
  const defaultLocale = options.defaultLocale ?? "en-US";
  if (isClientSide()) return createDocumentLangMonitor(defaultLocale);
  return options.serverSide
    ? toLocaleSource(options.serverSide)
    : freeze({ getLocale: () => defaultLocale });
}
