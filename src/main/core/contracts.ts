/**
 * The shapes the parties agree on: between component and translation author
 * (`Namespace`, `TextBundle`, `TextsOf`), between an app and the core (`LocaleSource`,
 * `TextSource`, `TextMiddleware`), and between the core and a binding (`I18nRuntime`,
 * `I18n`). Types only; no runtime code lives here.
 *
 * Everything exported here IS public API - `index.ts` re-exports it wholesale. A type
 * two core modules need but consumers do not is derived where it is used (see
 * `TextValue` in `text-source.ts`), never added here.
 */

export type {
  BoundTexts,
  ChangeListener,
  DateTimeFormatter,
  DefaultTextSourceOptions,
  I18n,
  I18nConfig,
  I18nRuntime,
  ListFormatter,
  LoadingAware,
  Locale,
  LocaleAware,
  LocaleSource,
  Namespace,
  NamespaceKey,
  NamespaceTexts,
  NumberFormatter,
  RelativeTimeFormatter,
  ResolveContext,
  TextAccess,
  TextBundle,
  TextCatalog,
  TextInput,
  TextKey,
  TextMap,
  TextMiddleware,
  TextRequest,
  TextResolver,
  TextSource,
  TextsOf,
  Translation,
  TranslationFn,
  UnboundTexts,
  Unsubscribe,
};

// # Types ---------------------------------------------------------------------------

// Primitive aliases
type Locale = string; // NOSONAR // a BCP-47 language tag, e.g. "en-US", "de", "zh-Hant-TW"
type TextKey = string; // NOSONAR // a key within a namespace
type NamespaceKey = string; // NOSONAR // a namespace's `key`
type Unsubscribe = () => void; // returned by subscriptions; idempotent to call
type ChangeListener = () => void;

// A parameterized translation: typed params + an I18n facade -> string. The facade is
// bound to the locale the text was FOUND in (source hits, incl. fallback candidates)
// or to the requested locale (namespace defaults).
type TranslationFn<T extends Record<string, unknown>> = (params: T, i18n: I18n) => string;

// Extracts the params object type from a TranslationFn. (internal)
type TranslationParams<T> = T extends TranslationFn<infer P> ? P : never;

// Authoring alias: `Translation` = string (static), `Translation<{n:number}>` = fn (dynamic).
type Translation<T extends Record<string, unknown> = never> = [T] extends [never]
  ? string
  : TranslationFn<T>;

// One namespace's shape: key -> static string | translation fn. A namespace's
// `defaults` object both defines this shape and provides the texts of last resort.
type TextMap = Record<string, Translation | Translation<any>>;

// Translations for one locale, derived from the defaults: same keys (all optional -
// anything missing falls through the pipeline down to the default), same param shapes.
type TextsOf<T extends TextMap> = {
  [K in keyof T]?: T[K] extends TranslationFn<infer P> ? TranslationFn<P> : string;
};

// A typed namespace: pure data - resolution identity (`key`, matched as a string, so
// duplicate module copies in one bundle still interoperate) plus the default texts.
type Namespace<T extends TextMap> = Readonly<{
  key: string;
  defaults: Readonly<T>;
}>;

// A namespace paired with texts for one locale, produced by `allTexts`/`someTexts`.
type NamespaceTexts<T extends TextMap> = Readonly<{
  namespace: Namespace<T>;
  texts: TextsOf<T>;
}>;

// Translations grouped by locale. Each locale maps to one namespace group, or a list
// of them when the locale carries translations for several namespaces at once.
type TextBundle = Record<Locale, NamespaceTexts<any> | NamespaceTexts<any>[]>;

// Partition a TextMap's keys by whether their value is a function.
type TextKeysWithParams<T extends Record<string, unknown>> = {
  [K in keyof T]: T[K] extends TranslationFn<any> ? K : never;
}[keyof T];
type TextKeysWithoutParams<T extends TextMap> = Exclude<keyof T, TextKeysWithParams<T>>;

// `bindTexts()` (no namespace): a fully-qualified lookup, exactly like `text`.
type UnboundTexts = {
  <T extends TextMap, K extends TextKeysWithoutParams<T>>(namespace: Namespace<T>, key: K): string;
  <T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;
};

// `bindTexts(namespace)`: scoped to T - call `t(key[, params])` - while still
// accepting a fully-qualified `t(otherNamespace, key[, params])` for any other.
type BoundTexts<T extends TextMap> = {
  <K extends TextKeysWithoutParams<T>>(key: K): string;
  <K extends TextKeysWithParams<T>>(key: K, params: TranslationParams<T[K]>): string;
  <U extends TextMap, K extends TextKeysWithoutParams<U>>(namespace: Namespace<U>, key: K): string;
  <U extends TextMap, K extends TextKeysWithParams<U>>(
    namespace: Namespace<U>,
    key: K,
    params: TranslationParams<U[K]>,
  ): string;
};

// # Strategies ----------------------------------------------------------------------

// Locale strategy: what locale are we in, and notify me when it changes.
type LocaleSource = Readonly<{
  getLocale(): Locale;
  onChange?(listener: ChangeListener): Unsubscribe; // locale changed
}>;

type TextRequest = Readonly<{
  locale: Locale;
  namespace: Namespace<any>;
  key: TextKey;
  params: unknown;
}>;

// The room the question is asked in. Second growth spot.
// `localize(locale)` re-enters the FULL pipeline (middlewares included), so nested
// lookups made by translation functions are middleware-visible too. Consequently a
// translation function that looks up its own key recurses forever - don't.
type ResolveContext = Readonly<{
  localize(locale: Locale): I18n;
}>;

// Contract: string (including "") = found. `undefined` = miss / not mine.
type TextResolver = (request: TextRequest, context: ResolveContext) => string | undefined;

// A text strategy = resolver + its own change channel (async resource loads, ...).
// The runtime merges this with LocaleSource.onChange into I18nRuntime.onChange.
// `resolveExact` is an optional fast path used by `hasText(..., false)`: it checks
// only the current locale (within-language narrowing included) without going through
// any fallback-locale combinator or namespace defaults. Third-party adapters that
// cannot efficiently support it can omit it - `hasText(false)` will return false when
// it is absent.
//
// This is exactly the contract the CORE consumes (`resolve`/`resolveExact`/`onChange`).
// The optional async-loading capability (`LoadingAware`) is deliberately NOT folded in
// here: the pipeline never calls it. A source that supports waiting layers it on
// separately - its type is `TextSource & LoadingAware` - and only `ensureTexts` on the
// runtime, which every gate goes through, reaches for it.
type TextSource = Readonly<{
  resolve: TextResolver;
  resolveExact?(locale: Locale, namespace: Namespace<any>, key: TextKey): string | undefined;
  onChange?(listener: ChangeListener): Unsubscribe; // texts changed
}>;

// The OPTIONAL async-loading capability, layered onto a `TextSource` (as
// `TextSource & LoadingAware`) by sources that fetch texts on demand. Reached only
// through `I18nRuntime.ensureTexts`, NEVER by the resolution pipeline or an `I18n`
// facade: loading is a source + app concern, kept off the lean, sync component-facing
// type. Sources that are always synchronously available omit it.
//
// `ensure` answers ONE question - "can I render now, or must I wait?":
//
//   - `undefined` - nothing to wait for. Either the texts are here, or there is nothing
//     to load for this pair, or a previous attempt failed and was given up on.
//   - a Promise    - a load is in flight; await it, then ask again.
//
// Crucially it also STARTS the load when none is running: a gate asks BEFORE anything
// has read a text, so a pure observer would always answer "not loading" and the gate
// would render defaults - exactly the flash it exists to prevent.
//
// It covers the whole resolution path of its source (within-language narrowing and, if
// configured, the fallback locales), NEVER rejects - a failed load resolves and is final,
// so a Suspense gate always un-suspends and resolution falls through to the defaults.
type LoadingAware = Readonly<{
  ensure(locale: Locale, namespace: Namespace<any>): Promise<void> | undefined;
}>;

// Decoration, distinct from replacement. Index 0 = outermost (runs first, delegates
// last). `next()` delegates downstream; `next(patch)` delegates with a rewritten
// request; returning without calling `next` short-circuits. `next() === undefined`
// means a HARD miss: neither the source nor the namespace defaults had the key.
type TextMiddleware = (
  request: TextRequest,
  context: ResolveContext,
  next: (patch?: Partial<TextRequest>) => string | undefined,
) => string | undefined;

// # The facade ----------------------------------------------------------------------
//
// The facade is assembled from small, single-concern capability types, so a caller
// can depend on only the slice it uses - e.g. a formatting helper takes
// `NumberFormatter & DateTimeFormatter` rather than the whole `I18n`.

// Text resolution: the typed lookup plus its standalone/bound variants.
type TextAccess = Readonly<{
  // Overload 1 - static keys (value is a string): no params.
  text<T extends TextMap, K extends TextKeysWithoutParams<T>>(
    namespace: Namespace<T>,
    key: K,
  ): string;

  // Overload 2 - dynamic keys (value is a TranslationFn): params required, typed to the fn.
  text<T extends TextMap, K extends TextKeysWithParams<T>>(
    namespace: Namespace<T>,
    key: K,
    params: TranslationParams<T[K]>,
  ): string;

  // A standalone text-lookup function: without a namespace exactly `text`
  // (`UnboundTexts`); with one scoped to it, while still accepting a fully-qualified
  // `t(namespace, key[, params])` for any other (`BoundTexts<T>`).
  bindTexts(): UnboundTexts;
  bindTexts<T extends TextMap>(namespace: Namespace<T>): BoundTexts<T>;

  // Check whether a translation exists for the given key.
  // `includeFallback: false` (default) - true only when the textSource has a hit for
  // the current locale (within-language narrowing included, fallback locales and
  // namespace defaults excluded). Use to detect whether a real translation is present.
  // `includeFallback: true` - runs the full pipeline (fallback locales + defaults);
  // true whenever `text()` would return something other than the bare key.
  hasText<T extends TextMap, K extends keyof T>(
    namespace: Namespace<T>,
    key: K,
    includeFallback?: boolean,
  ): boolean;
}>;

// Locale identity and locale-scoped siblings. `locale()` reports this facade's locale
// (the ambient one unless the facade is bound); `withLocale(locale)` returns a sibling
// statically bound to that locale, on the same runtime.
type LocaleAware = Readonly<{
  locale(): Locale;
  withLocale(locale: Locale): I18n;
}>;

// The fixed Intl number-formatting core - deliberately not configurable. Formatter
// instances are cached and shared; Intl formatters are effectively immutable.
type NumberFormatter = Readonly<{
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatNumberRange(start: number, end: number, options?: Intl.NumberFormatOptions): string;
  numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat;
}>;

// The fixed Intl date/time-formatting core - see NumberFormatter.
type DateTimeFormatter = Readonly<{
  formatDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
  formatDateTimeRange(start: Date, end: Date, options?: Intl.DateTimeFormatOptions): string;
  dateTimeFormat(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
}>;

// Locale-aware relative time: "3 days ago", "in 2 weeks".
type RelativeTimeFormatter = Readonly<{
  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string;
  relativeTimeFormat(options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat;
}>;

// Locale-aware list formatting: "apples, bananas, and oranges" / "apples or bananas".
type ListFormatter = Readonly<{
  formatList(list: Iterable<string>, options?: Intl.ListFormatOptions): string;
  listFormat(options?: Intl.ListFormatOptions): Intl.ListFormat;
}>;

// THE component-facing type, assembled from the capability types above. A facade is a
// stateless VIEW on an I18nRuntime: it asks, formats, and owns the miss policy - it
// holds no state, starts nothing, and waits for nothing. Everything that has a
// lifetime (the wiring, the change channel, on-demand loading) lives on the runtime.
type I18n = TextAccess &
  LocaleAware &
  NumberFormatter &
  DateTimeFormatter &
  RelativeTimeFormatter &
  ListFormatter;

// The app-level object: the wired strategies, the change channel, and the loading gate.
// `setupI18n` produces one, the app distributes it (argument, React context, the DOM
// Context Community Protocol), and `createI18n(runtime)` derives a facade from it.
//
// The split is what makes bindings writable OUTSIDE this package: everything a facade
// needs is here, in public form, so a Vue/Svelte/plain-custom-element binding can build
// its own `createI18n` and its own gate with no privileged access.
//
// Every method takes the locale explicitly: the runtime has no locale of its own -
// `currentLocale()` reads the LocaleSource, a bound facade passes its fixed tag.
type I18nRuntime = Readonly<{
  // The ambient locale right now, per the configured LocaleSource.
  currentLocale(): Locale;

  // Locale AND text changes (e.g. an async bundle arrived), on one channel.
  onChange(listener: ChangeListener): Unsubscribe;

  // The full pipeline: middlewares -> textSource -> namespace defaults. `undefined` is
  // a hard miss - turning that into the bare key is the facade's policy, not ours.
  resolveText(
    namespace: Namespace<any>,
    key: TextKey,
    params: unknown,
    locale: Locale,
  ): string | undefined;

  // Existence, WITHOUT producing the text - so a key whose default is a translation
  // function counts too (`resolveText` would have to invoke it, and cannot without
  // params). `includeFallback: false` asks the source alone for this locale
  // (within-language narrowing included); `true` asks the whole pipeline plus defaults.
  hasText(
    namespace: Namespace<any>,
    key: TextKey,
    locale: Locale,
    includeFallback: boolean,
  ): boolean;

  // The gate: STARTS whatever loading these namespaces need and reports whether to
  // wait. `undefined` = render now (loaded, nothing to load, or the source cannot
  // load at all). A promise = in flight; it never rejects, so a gate always resolves.
  ensureTexts(namespaces: readonly Namespace<any>[], locale: Locale): Promise<void> | undefined;
}>;

// The config contains strategies and middlewares - nothing else. It neither knows
// nor privileges any concrete implementation.
type I18nConfig = Readonly<{
  // Default: `defaultLocaleSource()` - <html lang> monitor on the client, "en-US"
  // elsewhere. The shorthand forms are accepted too: a fixed tag (`"de-CH"`, the usual
  // shape for a per-request runtime on a server) or a plain getter.
  localeSource?: Locale | (() => Locale) | LocaleSource;
  // Default: none - resolution falls through to the namespace defaults. A list is
  // composed into one source: the FIRST that does not answer `undefined` wins, so an
  // app can put its own source ahead of the sources holding component-library texts.
  textSource?: TextSource | readonly TextSource[];
  // Decorates every resolution. Index 0 is outermost.
  middlewares?: TextMiddleware[];
}>;

// A lazy, SCOPED contribution: it declares which namespaces and locales it can serve,
// so a source can load exactly the pair a gate asks for instead of everything at once.
// Produced by `textCatalog` - the declaration is readable data (`textCoverage` reports
// on it), the loading is `load`. Returning `undefined` from `load` means "nothing here".
type TextCatalog = Readonly<{
  namespaces: readonly Namespace<any>[];
  locales: readonly Locale[];
  load(locale: Locale): TextBundle | Promise<TextBundle | undefined> | undefined;
}>;

// One entry of `texts`: ready now, in flight, or loadable on demand.
type TextInput = TextBundle | Promise<TextBundle> | TextCatalog;

type DefaultTextSourceOptions = Readonly<{
  // A PRIORITY list, not a merge chain: on a key clash the EARLIER entry wins,
  // regardless of when an async one arrives. Put overrides first.
  texts?: readonly TextInput[];
  // Tried in order after the requested locale misses; invalid tags fail loudly at setup.
  fallbackLocales?: Locale[];
}>;
