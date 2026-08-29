/**
 * The built-in TextSource: a store fed by declarative contributions, plus the two
 * combinators the core composes with (cross-language fallback and the priority list).
 * It has no privileged status - it plugs into `I18nConfig.textSource` exactly like a
 * third-party adapter would.
 */

import { buildLanguageTagChain, normalizeLocale } from "./locale-tags.js";
import { checkLocaleTags, createListeners, createRecord, freeze } from "./util.js";
import type {
  ChangeListener,
  DefaultTextSourceOptions,
  LoadingAware,
  Locale,
  Namespace,
  NamespaceKey,
  ResolveContext,
  TextBundle,
  TextCatalog,
  TextInput,
  TextKey,
  TextRequest,
  TextMap,
  TextSource,
  Unsubscribe,
} from "./contracts.js";

export { composeSources, defaultTextSource, hasEnsure, withFallbackLocales };

// What one stored translation holds. DERIVED from the public shape, never restated -
// a second spelling could drift from it silently.
type TextValue = TextMap[string];

// Internal storage shapes: locale -> namespaceKey -> textKey -> entry.
// Each entry remembers the PRIORITY (the index of its `texts` entry) that wrote it, so
// precedence follows the declared order and not the order async loads happen to settle.
type StoredText = { value: TextValue; priority: number };
type NamespaceRecord = Record<string, StoredText>;
type LocaleRecord = Record<string, NamespaceRecord>;
type DictionaryStore = Record<string, LocaleRecord>;

/**
 * Resolve a request against a store, narrowing tags within the requested language.
 * `undefined` on a miss - the pipeline then falls through (e.g. to fallback locales
 * via `withFallbackLocales`, or to the namespace defaults).
 */
function resolveFromStore(
  store: DictionaryStore,
  request: TextRequest,
  context: ResolveContext,
): string | undefined {
  for (const candidate of buildLanguageTagChain(request.locale)) {
    const value = store[candidate]?.[request.namespace.key]?.[request.key]?.value;
    if (typeof value === "string") return value;
    if (typeof value === "function" && request.params != null) {
      // Invoke with an I18n bound to the FOUND locale (re-enters the full pipeline).
      return value(request.params, context.localize(candidate));
    }
    // absent or function-without-params -> next candidate
  }
  return undefined;
}

/**
 * Merge one TextBundle into a store at the given priority (lower = stronger). A key
 * already held by an equal or stronger priority is left alone, so a late-arriving
 * low-priority load cannot displace a high-priority one and settle order is irrelevant.
 * Returns whether anything was written.
 */
function addBundleToStore(store: DictionaryStore, bundle: TextBundle, priority: number): boolean {
  let added = false;
  for (const rawLocale of Object.keys(bundle)) {
    const localeRecord = (store[normalizeLocale(rawLocale)] ??= createRecord<NamespaceRecord>());
    const entry = bundle[rawLocale];
    for (const { namespace, texts } of Array.isArray(entry) ? entry : [entry]) {
      const nsRecord = (localeRecord[namespace.key] ??= createRecord<StoredText>());
      for (const [key, value] of Object.entries(texts as Record<string, TextValue | undefined>)) {
        if (value === undefined) continue; // explicit undefined must not shadow anything
        const held = nsRecord[key];
        if (held && held.priority <= priority) continue; // earlier entry wins
        nsRecord[key] = { value, priority };
        added = true;
      }
    }
  }
  return added;
}

/** Does the store hold ANY text for this (tag, namespace) pair? Namespace-level readiness. */
function storeCovers(store: DictionaryStore, tag: Locale, namespaceKey: NamespaceKey): boolean {
  const nsRecord = store[tag]?.[namespaceKey];
  return !!nsRecord && Object.keys(nsRecord).length > 0;
}

/** Is this `texts` entry a catalog rather than a bundle or a promise of one? */
function isCatalog(input: TextInput): input is TextCatalog {
  const candidate = input as Partial<TextCatalog>;
  return typeof candidate.load === "function" && Array.isArray(candidate.namespaces);
}

/**
 * The built-in TextSource: a store fed by the declaratively provided `texts`. It has no
 * privileged status - it plugs into `I18nConfig.textSource` exactly like any third-party
 * adapter would.
 *
 * `texts` is a PRIORITY list, not a merge chain: on a key clash the EARLIER entry wins,
 * whenever it happens to arrive. Plain bundles are available immediately; promises
 * register when they settle; catalogs load on demand, when `ensure` is asked for a pair
 * they declare. Whenever texts land, `onChange` fires and hosts re-render.
 *
 * Catalogs make this source `LoadingAware`: `ensure(locale, ns)` walks the within-language
 * chain against each catalog's declared locales, loads the best match, and - if the
 * namespace is still uncovered afterwards - continues through `fallbackLocales`, so a gate
 * that awaits it has the whole resolution path in place. A failed load is reported and
 * final; resolution then falls through to the namespace defaults.
 */
function defaultTextSource(options: DefaultTextSourceOptions = {}): TextSource {
  const store: DictionaryStore = createRecord<LocaleRecord>();
  const listeners = createListeners();
  // Catalog + its priority, and the loads already started, keyed `prioritytag`.
  const catalogs: { catalog: TextCatalog; priority: number }[] = [];
  const attempts = new Map<string, Promise<void>>();

  const logLoadError = (reason: unknown): void =>
    console.error("i18n: loading texts failed", reason);
  const accept = (bundle: TextBundle | undefined, priority: number): void => {
    if (bundle && addBundleToStore(store, bundle, priority)) listeners.notify();
  };

  (options.texts ?? []).forEach((input, priority) => {
    if (isCatalog(input)) catalogs.push({ catalog: input, priority });
    else if (input instanceof Promise)
      input.then((bundle) => accept(bundle, priority), logLoadError);
    // nobody subscribed yet: no notification needed
    else addBundleToStore(store, input, priority);
  });

  /** Start (or join) the one load of `tag` from this catalog. Never rejects. */
  const loadFrom = (
    entry: { catalog: TextCatalog; priority: number },
    tag: Locale,
  ): Promise<void> => {
    const attemptKey = `${entry.priority}${tag}`;
    let attempt = attempts.get(attemptKey);
    if (!attempt) {
      attempt = (async () => {
        try {
          accept(await entry.catalog.load(tag), entry.priority);
          reportUnfulfilledClaims(entry.catalog, tag);
        } catch (reason) {
          logLoadError(reason); // final: the attempt stays recorded, so we never retry
        }
      })();
      attempts.set(attemptKey, attempt);
    }
    return attempt;
  };

  /**
   * A catalog's declaration is a promise about what its bundles contain, and nothing
   * else checks it: a namespace claimed but absent from the loaded file just falls
   * through to the defaults, silently, and `textCoverage` would still report it as
   * covered. So say so, once, right where the mismatch is.
   */
  const reportUnfulfilledClaims = (catalog: TextCatalog, tag: Locale): void => {
    const unfulfilled = catalog.namespaces
      .filter((namespace) => !storeCovers(store, tag, namespace.key))
      .map((namespace) => `"${namespace.key}"`);
    if (unfulfilled.length) {
      console.warn(
        `i18n: a catalog declares ${unfulfilled.join(", ")} for "${tag}", ` +
          `but its bundle carries no texts for them`,
      );
    }
  };

  /** The catalog tag to try for this locale: the most specific declared match, if any. */
  const bestTag = (catalog: TextCatalog, locale: Locale): Locale | undefined => {
    const declared = new Set(catalog.locales.map(normalizeLocale));
    return buildLanguageTagChain(locale).find((tag) => declared.has(tag));
  };

  /** Load every catalog's best match for `locale`. `undefined` when there is nothing to do. */
  const ensureLocale = (locale: Locale, namespace: Namespace<any>): Promise<void> | undefined => {
    const pending: Promise<void>[] = [];
    for (const entry of catalogs) {
      if (!entry.catalog.namespaces.some((ns) => ns.key === namespace.key)) continue;
      const tag = bestTag(entry.catalog, locale);
      if (!tag || storeCovers(store, tag, namespace.key)) continue;
      pending.push(loadFrom(entry, tag));
    }
    return pending.length ? Promise.all(pending).then(() => undefined) : undefined;
  };

  /** Is the namespace covered for `locale` by anything already in the store? */
  const covered = (locale: Locale, namespace: Namespace<any>): boolean =>
    buildLanguageTagChain(locale).some((tag) => storeCovers(store, tag, namespace.key));

  const runEnsure = (locale: Locale, namespace: Namespace<any>): Promise<void> | undefined => {
    const requested = ensureLocale(locale, namespace);
    const fallbacks = options.fallbackLocales ?? [];
    // No fallbacks configured, or the requested locale is already covered: one round.
    if (!fallbacks.length) return requested;
    if (!requested && covered(locale, namespace)) return undefined;

    return (async () => {
      await requested;
      // Only pay for the fallback chain when the requested locale really came up empty.
      if (covered(locale, namespace)) return;
      for (const fallback of fallbacks) {
        await ensureLocale(fallback, namespace);
        if (covered(fallback, namespace)) return;
      }
    })();
  };

  // Memoized per (locale, namespace): the catalogs are fixed at construction, so once a
  // pair has been walked there is never anything more to do for it. Keeps `ensure` cheap
  // enough to call on every render AND on every resolution miss.
  const ensured = new Map<string, Promise<void> | undefined>();
  const ensure = (locale: Locale, namespace: Namespace<any>): Promise<void> | undefined => {
    const memoKey = `${normalizeLocale(locale)}${namespace.key}`;
    if (ensured.has(memoKey)) return ensured.get(memoKey);
    const pending = runEnsure(locale, namespace);
    ensured.set(memoKey, pending);
    void pending?.then(() => ensured.set(memoKey, undefined)); // settled: nothing left to await
    return pending;
  };

  const source: TextSource & LoadingAware = freeze({
    resolve: (request, context) => {
      const hit = resolveFromStore(store, request, context);
      if (hit !== undefined) return hit;
      // Demand-driven: reading an untranslated text starts its load, so an app that
      // never gates still gets its translations - defaults first, real texts on the
      // `onChange` that follows. Gating only removes the flash in between.
      void ensure(request.locale, request.namespace);
      return undefined;
    },
    resolveExact: (locale, namespace, key) => {
      // Walk only the within-language chain for this locale - no fallbacks, no defaults.
      for (const candidate of buildLanguageTagChain(locale)) {
        const value = store[candidate]?.[namespace.key]?.[key]?.value;
        if (value !== undefined) return typeof value === "string" ? value : "";
      }
      return undefined;
    },
    ensure,
    onChange: listeners.add,
  });

  const fallbacks = options.fallbackLocales;
  return fallbacks?.length ? withFallbackLocales(source, fallbacks) : source;
}

// # TextSource combinators ------------------------------------------------------------

/**
 * Decorate a TextSource with a cross-language fallback chain: the requested locale
 * first, then each fallback in order (candidates normalizing to an already-tried tag
 * are skipped). The found candidate travels as `request.locale`, so dynamic
 * translations get an I18n bound to the locale they were actually found in. Being a
 * SOURCE combinator, the whole chain is exhausted before the namespace defaults apply.
 * Invalid fallback tags fail loudly here, at setup - not at the first miss.
 */
function withFallbackLocales(source: TextSource, fallbackLocales: Locale[]): TextSource {
  checkLocaleTags(fallbackLocales);
  const fallbacks: readonly Locale[] = freeze([...fallbackLocales]);

  return freeze({
    resolve: (request, context) => {
      const seen = new Set<string>();
      for (const candidate of [request.locale, ...fallbacks]) {
        const normalized = normalizeLocale(candidate);
        if (seen.has(normalized)) continue; // already tried an equivalent tag
        seen.add(normalized);
        const req =
          candidate === request.locale ? request : freeze({ ...request, locale: candidate });
        const hit = source.resolve(req, context);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
    // Forward the wrapped source's change channel (via a lambda: keeps its receiver).
    ...(source.onChange && {
      onChange: (listener: ChangeListener): Unsubscribe => source.onChange!(listener), // NOSONAR
    }),
    // Forward resolveExact unwrapped - the whole point is to bypass this combinator.
    ...(source.resolveExact && {
      resolveExact: (locale: Locale, namespace: Namespace<any>, key: TextKey) =>
        source.resolveExact!(locale, namespace, key), // NOSONAR
    }),
    // Forward `ensure` unwrapped too: the wrapped source already walks the fallback
    // chain when it loads, so wrapping it here would only duplicate the work.
    ...(hasEnsure(source) && {
      ensure: (locale: Locale, namespace: Namespace<any>) => source.ensure(locale, namespace), // NOSONAR
    }),
  });
}

/** Narrow a source to one that can be awaited. */
function hasEnsure(source: TextSource): source is TextSource & LoadingAware {
  return typeof (source as Partial<LoadingAware>).ensure === "function";
}

/**
 * Compose sources into one: the FIRST that answers something other than `undefined`
 * wins, for `resolve` and `resolveExact` alike. `onChange` subscribes to all of them,
 * `ensure` fans out to every member that has it and settles when they all have -
 * nobody knows in advance which source will end up serving the namespace, and a source
 * that does not claim it answers `undefined` at once, so the fan-out costs nothing.
 */
function composeSources(sources: readonly TextSource[]): TextSource | undefined {
  if (sources.length < 2) return sources[0];
  const members: readonly TextSource[] = freeze([...sources]);
  const awaitable = members.filter(hasEnsure);

  return freeze({
    resolve: (request, context) => {
      for (const source of members) {
        const hit = source.resolve(request, context);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
    resolveExact: (locale, namespace, key) => {
      for (const source of members) {
        const hit = source.resolveExact?.(locale, namespace, key);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
    onChange: (listener: ChangeListener): Unsubscribe => {
      const unsubscribes = members.map((source) => source.onChange?.(listener));
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe?.();
      };
    },
    ...(awaitable.length && {
      ensure: (locale: Locale, namespace: Namespace<any>): Promise<void> | undefined => {
        const pending = awaitable
          .map((source) => source.ensure(locale, namespace))
          .filter((p): p is Promise<void> => p !== undefined);
        return pending.length ? Promise.all(pending).then(() => undefined) : undefined;
      },
    }),
  });
}
