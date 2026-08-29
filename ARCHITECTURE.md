# Architecture

How Picolingo is put together and why. The [README](README.md) is the tour of the public
API; this document is the reasoning behind it, for anyone changing the library itself.

## Repository layout

Maven-style: shipped code in `src/main`, tests in `src/test` mirroring its directory
structure. `tsconfig.json` and the Vite build only ever see `src/main`; Vitest only ever
sees `src/test`. No exclude rules, no test files in the published tree.

```
src/main/
  core/            -> "."                (dependency-free core; vanilla JS/TS)
  message-format/  -> "./message-format" (ICU MessageFormat helper)
  react/           -> "./react"          (React is an optional peer)
  web-components/  -> "./web-components" (custom elements, dependency-free)
  dev/             -> "./dev"            (tooling; never imported by production code)
src/test/          mirrors src/main
```

## Two objects, one split

`setupI18n(config?)` wires the strategies into an **`I18nRuntime`** - everything with a
lifetime: the composed text source, the middlewares, the merged change channel, the
loading state. Its surface is `currentLocale`, `onChange`, `resolveText`, `hasText`,
`ensureTexts`.

`createI18n(runtime[, locale])` derives an **`I18n`** facade - a stateless view that
asks, formats, and owns the miss policy (`undefined` -> the bare key). Creating one
allocates a plain object and nothing else, so a binding may mint a fresh facade per
change to signal "something changed" by identity; `createI18n` therefore always creates.
Without a locale the facade follows `currentLocale()`; with one it is statically bound.

`withLocale` is the accessor twin of that factory: it hands out siblings memoized per
`(runtime, canonical tag)` in a module-level WeakMap, so identity is stable for
dependency arrays and repeated calls in render code allocate nothing. Translation
functions receive those same siblings via `ResolveContext.localize`.

**Bindings distribute the RUNTIME, never a facade.** That is what makes a binding written
outside this package equal to the ones shipped here: everything a facade needs is public
on `I18nRuntime`, so nothing has to be smuggled along with an instance. `I18n` has no
`onChange` and no loading member; both live on the runtime.

## The strategies

The config contains three swappable strategies and nothing else:

- **`localeSource`** - which locale is active, and when it changes. A fixed tag or a
  plain getter is accepted as shorthand and wrapped internally, which is what a
  per-request runtime on a server usually wants.
- **`textSource`** - resolves `(locale, namespace, key, params) -> string | undefined`,
  and signals when the available texts change (e.g. an async bundle lands). `undefined`
  means a genuine miss, so adapters must do real miss detection rather than a truthiness
  check - `""` is a valid translation. A **list** is accepted and composed internally:
  the first source answering something other than `undefined` wins.
- **`middlewares`** - decorate the whole resolution pipeline, e.g. pseudo-localization or
  miss reporting.

**Intl formatting** (`formatNumber`, `formatDateTime`, `formatRelativeTime`, `formatList`
and the range/raw-formatter variants) is the one deliberately non-configurable part: a
fixed, cached-and-shared `Intl` core.

Two decoration layers, by concern:

- A **TextMiddleware** wraps the WHOLE resolution - it sees texts from any source AND
  from the namespace defaults, including nested lookups made by translation functions.
- A **TextSource combinator** wraps ONE source and sees its misses directly, e.g. the
  built-in cross-language fallback (`defaultTextSource({ fallbackLocales })`). This layer
  is internal: an app composes its own by writing a source that delegates to another.

## Resolution

```
middlewares -> textSource -> namespace defaults -> bare key
```

A string always comes back; `undefined` never escapes to a caller. The namespace defaults
sit INSIDE the pipeline, so middlewares see default-resolved texts too and
`next() === undefined` signals a hard miss.

**On-demand loading** is optional and layered, never part of the sync pipeline: a source
may implement `LoadingAware.ensure(locale, namespace) -> Promise<void> | undefined`
(`undefined` = nothing to wait for; a promise = in flight - and the call _starts_ the
load). `defaultTextSource` implements it once it has catalogs. The single consumer is
`I18nRuntime.ensureTexts(namespaces, locale)`, which fans out over the namespaces and is
what every gate is built on: `useSuspenseTexts` in React, `loading` in the custom-element
controller, or an `await` in an app. Everything degrades to "do nothing" when the
capability is absent.

**`hasText` reports existence without producing the text**, so a key whose default is a
translation function counts too - the pipeline alone would skip it, having no params to
invoke it with.

## The core modules

| Module             | What is in it                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `index.ts`         | The public export list - the `.` entry point. Nothing else.                                               |
| `contracts.ts`     | The shapes the parties agree on. No runtime code, and everything it exports is public API.                |
| `runtime.ts`       | `setupI18n` and `createI18n`, plus the memoized `withLocale` siblings.                                    |
| `text-source.ts`   | `defaultTextSource` (store, priority list, catalogs) and the two combinators.                             |
| `namespaces.ts`    | The authoring API: `createNamespace`, `bundleTexts`, `someTexts`/`allTexts`, `textCatalog`, `checkTexts`. |
| `pipeline.ts`      | Middlewares wrapped around the source and the defaults terminal.                                          |
| `intl.ts`          | The fixed, cached Intl core.                                                                              |
| `locale-source.ts` | `defaultLocaleSource` and the `<html lang>` monitor.                                                      |
| `locale-tags.ts`   | Tag matching, shared with `dev/` and re-exported by nothing.                                              |
| `util.ts`          | `freeze`, `createRecord`, `createListeners`, `checkLocaleTags`.                                           |

`index.ts` re-exports the types wholesale (`export type * from "./contracts.js"`), because
`contracts.ts` exports exactly the public surface - a second list could only drift from it.
The rule that keeps this true: a type two core modules need but consumers do not is
DERIVED where it is used (`type TextValue = TextMap[string]`), never added to
`contracts.ts`. Adding one there publishes it.

`index.ts` is an explicit export list, not `export *`. That is what keeps a module like
`locale-tags.ts` internal while `dev/index.ts` still imports it directly - `textCoverage`
must report on the store's own matching rules, not on a second implementation that would
drift from them.

## The other entry points

- **`./message-format`** - an ICU MessageFormat `msg` tagged-template helper built on
  `intl-messageformat`, producing a `TranslationFn`. Per-locale formatter instances are
  cached.
- **`./web-components`** - `connectI18n(host, { texts?, requestUpdate? })`, a reactive
  controller exposing `loading` (the DOM has no Suspense) plus `connect`/`disconnect` so
  a plain custom element without Lit's `addController`/`requestUpdate` can drive it; and
  `provideI18n` / `<i18n-provider .runtime>`, distributing the runtime over the DOM
  Context Community Protocol under `Symbol.for("picolingo.I18nRuntime@1")`. The `@1`
  versions the value contract, not the package: an incompatible copy finds no provider
  instead of calling a method that is gone. Runtime resolution is two-stage - context
  request, then the internal zero-config fallback. The entry uses an explicit export
  list to keep `ContextRequestEvent` and `i18nContext` module-internal.
- **`./react`** - `I18nProvider` (takes the runtime) plus `useI18n`, and the
  `useSuspenseTexts` gate, which returns `void`: gate and access are separate hooks so a
  route can hoist the gate for its whole subtree. The provider feeds both React context
  and the DOM context protocol from one `display: contents` wrapper, so web components
  rendered inside a React subtree are served too. `useI18n` is built on
  `useSyncExternalStore` over `runtime.onChange`, minting a fresh statically-bound facade
  per change - cheap, since facades are stateless views, and the identity change is what
  makes the store re-render. Written JSX-free (`createElement as h`) so it stays a `.ts`.
- **`./dev`** - `textCoverage` (declaration-based gap report; the namespace inventory is
  a required argument so an entirely untranslated namespace cannot pass silently) and
  `reportTextMisses` (a middleware logging every fall-through). Never imported by
  production code.

## Bundling

Every binding imports the core through `src/main/core/index.ts`, never a module behind
it, so Rollup emits the core once as `chunks/core-*.js` and every entry shares it - one
core instance, no duplication. The extra file costs a request, not bytes. React (and
`react-dom`) stay external: an optional peer, owned by the host app.

There is no library-owned configurable global state. Intl formatters are cached
module-globally, but as deterministic values that cache is semantically invisible.

## The three ecosystem roles

Kept strictly separate, so a component library, a translation pack and an app can evolve
without stepping on each other.

1. **Component author** - defines a `Namespace` via `createNamespace({ key, defaults })`.
   The defaults define both the TypeScript shape (keys and per-key param types) and the
   texts of last resort, so a component library works with zero app cooperation.
2. **Translation author** - produces a `TextBundle` via `bundleTexts(...)`, using
   `someTexts` (partial, falls through the pipeline) or `allTexts` (complete, checked at
   compile time AND at runtime). For lazy loading, a `TextCatalog` via
   `textCatalog({ namespaces, bundles })` declaring what exists and how to fetch it; the
   `bundles` keys ARE the locale list, and each value must use a string-literal
   `import()` so bundlers can resolve and split it.
3. **App author** - collects the contributions into a source with
   `defaultTextSource({ texts })` (a **priority list**: on a key clash the earlier entry
   wins, regardless of when async ones settle), picks a `localeSource`, and calls
   `setupI18n(config?)`. Runtimes are created explicitly and distributed by the app -
   argument passing, React context, or the DOM Context Community Protocol. For
   per-request SSR, one runtime per request over a shared module-scope source: the loaded
   texts live in the source, so the runtime is a thin wiring object.
