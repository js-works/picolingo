# Picolingo

![npm](https://img.shields.io/npm/v/picolingo)
![GitHub License](https://img.shields.io/github/license/js-works/picolingo)
![GitHub Last Commit](https://img.shields.io/github/last-commit/js-works/picolingo)
![GitHub Repo Size](https://img.shields.io/github/repo-size/js-works/picolingo)

> [!WARNING]
> **Early stage - not production-ready.** picolingo is in active, early development. The API may change without notice, and it has not been battle-tested in real-world applications. **Do not use it in production yet.** It's shared for evaluation, experimentation, and feedback - use it at your own risk.

Every app has things to say. **picolingo** is the friend who repeats them perfectly in whatever language the room is speaking. Components ship with something sensible to say out of the box, translators retell it, and your app just relays the current version to whoever's listening.

No global config to wrestle. No mystery singletons. No "why is this string suddenly `undefined`." Just a tiny, strongly-typed facade you create once and hand around.

```ts
import { setupI18n, createI18n, createNamespace } from "picolingo";

const greetingTexts = createNamespace({
  key: "greeting",
  defaults: {
    hello: "Hello",
    welcome: (params: { name: string }, i18n) => `Welcome, ${params.name}!`,
  },
});

const runtime = setupI18n(); // zero config - the defaults already work
const i18n = createI18n(runtime);

i18n.text(greetingTexts, "hello"); // "Hello"
i18n.text(greetingTexts, "welcome", { name: "Ada" }); // "Welcome, Ada!"
```

That's a fully working, fully typed component library. No locale files required until someone actually wants another language.

---

## Table of contents

- [Why picolingo](#why-picolingo)
- [Install](#install)
- [The three-minute tour](#the-three-minute-tour)
- [Who does what: the three roles](#who-does-what-the-three-roles)
- [Adding translations](#adding-translations)
- [Loading translations on demand](#loading-translations-on-demand)
- [Falling back gracefully](#falling-back-gracefully)
- [Formatting numbers, dates, and more](#formatting-numbers-dates-and-more)
- [Switching the language](#switching-the-language)
- [Staying in sync](#staying-in-sync)
- [Does this key exist? `hasText`](#does-this-key-exist-hastext)
- [Dynamic keys](#dynamic-keys)
- [Middlewares: the friend who embellishes every story](#middlewares-the-friend-who-embellishes-every-story)
- [Bring your own backend](#bring-your-own-backend)
- [Waiting for texts: `ensure`](#waiting-for-texts-ensure)
- [Finding gaps](#finding-gaps)
- [Ask for only what you need](#ask-for-only-what-you-need)
- [Message Format (ICU)](#message-format-icu)
- [React](#react)
- [Web Components](#web-components)
- [Server-side rendering](#server-side-rendering)
- [Resolution order, in one breath](#resolution-order-in-one-breath)
- [TypeScript setup](#typescript-setup)
- [API cheat sheet](#api-cheat-sheet)
- [Under the hood](#under-the-hood)
- [License](#license)

---

## Why picolingo

- **Zero-config components.** A namespace ships with its own default texts. A component library works the moment it's imported - no app cooperation, no setup step, no empty-string surprises.
- **Type-safe to the core.** Keys are checked. Parameters are checked, per key. `text(greetingTexts, "welcome")` won't compile without `{ name }`; `text(greetingTexts, "helo")` won't compile at all.
- **No hidden global state.** You wire a runtime with `setupI18n` and hand it around however you like. Nothing lurks in a module singleton.
- **Pluggable everything.** Locale detection and text resolution are swappable strategies. Keep the batteries-included defaults, compose them, or replace them with an adapter for any third-party i18n backend.
- **Batteries included.** A client `<html lang>` monitor, an async-and-lazy-capable text store, cross-language fallback, and the full `Intl` formatting suite - all cached and shared.
- **Reactive.** Locale changes and late-arriving translations both fire one `onChange`. Wire it to your renderer once and forget about it.
- **Tiny and dependency-free.** It's a facade and a few strategies. That's the whole thing.

---

## Install

```bash
npm install picolingo
# or
pnpm add picolingo
# or
yarn add picolingo
```

That's the whole install - everything below lives in this one package as separate **entry points** (subpath imports), so you only pull in the code you actually use:

```ts
import { setupI18n, createI18n } from "picolingo"; // the core - dependency-free, always available
import { msg } from "picolingo/message-format"; // ICU MessageFormat helper (bundles intl-messageformat)
import { I18nProvider, useI18n } from "picolingo/react"; // React bindings (react is an optional peer)
import { connectI18n } from "picolingo/web-components"; // custom-element / Lit bindings (dependency-free)
import { textCoverage } from "picolingo/dev"; // tooling for development and CI, never for production
```

Nothing to install separately for `./message-format`, `./web-components` or `./dev` - all three are dependency-free and bundle whatever they need. `./react` is the only entry point with an external dependency: `react` (`>=18`), declared as an optional peer.

---

## The three-minute tour

```ts
import {
  setupI18n,
  createI18n,
  createNamespace,
  defaultTextSource,
  bundleTexts,
  allTexts,
  someTexts,
} from "picolingo";

// 1. A component author defines a text namespace with default text (in en-US).
const greetingTexts = createNamespace({
  key: "greeting",
  defaults: {
    hello: "Hello",
    welcome: (p: { name: string }) => `Welcome, ${p.name}!`,
  },
});

// 2. Translation authors retell it - English (the defaults, made explicit) and German,
//    each shipped as its own bundle.
const greetingEnglish = bundleTexts({
  en: allTexts(greetingTexts, greetingTexts.defaults),
});

const greetingGerman = bundleTexts({
  de: [
    allTexts(greetingTexts, {
      hello: "Hallo",
      welcome: (params) => `Willkommen, ${params.name}!`,
    }),
  ],
  "de-CH": [
    someTexts(greetingTexts, {
      hello: "Grüezi", // just the one word differs; the rest narrows to `de`
    }),
  ],
});

// 3. The app collects the bundles into one runtime, and derives a facade to read from.
const runtime = setupI18n({
  textSource: defaultTextSource({
    texts: [greetingEnglish, greetingGerman],
    fallbackLocales: ["en"],
  }),
});

const i18n = createI18n(runtime);

i18n.text(greetingTexts, "hello"); // "Hello"  (or "Hallo" when the locale is German)
i18n.text(greetingTexts, "welcome", { name: "Ada" }); // parameters are typed to the key

// Prefer not to repeat the namespace? Bind it once.
const t = i18n.bindTexts(greetingTexts);
t("hello"); // scoped to `greetingTexts`
t("welcome", { name: "Ada" });
t(otherTexts, "key"); // still fully-qualified for anything else

// The Intl formatting core comes for free, always in the active locale.
i18n.formatNumber(1234.56); // "1,234.56" (de: "1.234,56", de-CH: "1'234.56")
i18n.formatDateTime(new Date(), { dateStyle: "long" }); // "July 17, 2026" (de/de-CH: "17. Juli 2026")
```

Shipping every translation up front is fine for a handful of locales. Once there are more, a
**catalog** says which namespaces and locales exist and how to fetch one, and nothing is
downloaded until it is needed:

```ts
import { textCatalog } from "picolingo";

// 4. Whoever owns the translations exports one catalog. A component library exports its
//    own; an app does the same for its screens.
export const greetingCatalog = textCatalog({
  namespaces: [greetingTexts],
  bundles: {
    de: () => import("./locales/de.js"),
    fr: () => import("./locales/fr.js"),
  },
});

// 5. The app lists it like any other contribution.
const runtime = setupI18n({
  textSource: defaultTextSource({ texts: [greetingEnglish, greetingCatalog] }),
});
```

Reading a text now starts its download and the UI updates when it arrives - a default shows
in between. To skip that in-between state, wait for the texts before rendering. In React
that is a gate above the read:

```tsx
function Greeting() {
  useSuspenseTexts([greetingTexts]); // suspends until the texts are here
  const { t } = useI18n(greetingTexts);
  return <h1>{t("hello")}</h1>;
}
```

That is the whole model: **defaults so nothing is ever broken, catalogs so nothing is
downloaded unnecessarily, and a gate where the wait matters more than the flash.**

---

## Who does what: the three roles

picolingo keeps three jobs strictly separate - so a component library, a translation pack, and an app can each evolve without stepping on the others.

<!-- prettier-ignore -->
| Role                   | Ships                                                                  | Tool                                     |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| **Component author**   | A namespace with default texts                                         | `createNamespace`                        |
| **Translation author** | A `TextBundle` of translations, grouped by locale - plus, for on-demand loading, a `TextCatalog` declaring what exists | `bundleTexts` + `someTexts` / `allTexts`, `textCatalog` |
| **App author**         | The wiring: collect the contributions, pick a locale source, set up the runtime | `defaultTextSource` + `setupI18n`        |

The translation author's job ends at "here is a bundle" - or, for lazy loading, at "here is a catalog of what I have and how to fetch it." How either reaches whatever text source the app uses is none of their concern, and the component author never has to know translations exist at all.

---

## Adding translations

A **namespace** defines both the _shape_ (which keys exist and what parameters they take) and the _texts of last resort_. Translations for other locales are attached separately, and there are two ways to do it:

```ts
import { someTexts, allTexts } from "picolingo";

// `someTexts` - partial. Missing keys fall back through the pipeline to the default.
someTexts(greetingTexts, { hello: "Bonjour" });

// `allTexts` - complete. Every key must be present, checked at compile time AND runtime.
allTexts(greetingTexts, {
  hello: "Bonjour",
  welcome: (params) => `Bienvenue, ${params.name} !`,
});
```

Group them by locale into a bundle. Each locale takes a single namespace group - or an array of them, when one locale carries translations for several namespaces:

```ts
export const greetingFrench = bundleTexts({
  fr: someTexts(greetingTexts, { hello: "Bonjour" }),
  // multiple namespaces for one locale? pass an array:
  // fr: [someTexts(greetingTexts, { hello: "Bonjour" }), someTexts(datePickerTexts, { today: "Aujourd'hui" })],
});
```

> **Heads up - the errors are on your side.** Pass a key that doesn't exist, or a string where a function was expected, and you get one readable `TypeError` listing every problem at once - at the declaration site, not at some distant call. TypeScript catches it first; the runtime check catches plain-JS callers too.

---

## Loading translations on demand

`defaultTextSource` takes a list of contributions under `texts`, in three flavours:

```ts
const runtime = setupI18n({
  textSource: defaultTextSource({
    texts: [
      greetingGerman, // 1. a TextBundle, ready now
      fetchRemoteBundle(), // 2. a Promise<TextBundle>, registered when it settles
      greetingCatalog, // 3. a TextCatalog, loaded per (locale, namespace) when needed
    ],
    fallbackLocales: ["en"],
  }),
});
```

### Catalogs

A catalog declares **which namespaces and locales it covers** and **how to load one**:

```ts
export const datePickerCatalog = textCatalog({
  namespaces: [datePickerTexts, calendarTexts],
  bundles: {
    de: () => import("./locales/de.js"),
    fr: () => import("./locales/fr.js"),
  },
});
```

The keys of `bundles` are the locale list - there is no second declaration to drift out of
sync with the files that actually exist. Each value is a plain `() => import("...")` with a
**string literal**: that is the form every bundler can resolve and code-split. A template
literal such as ``() => import(`./locales/${locale}.js`)`` cannot be analysed at build time
and, once bundled, resolves relative to the output file - which is not where the locale
files are.

One bundle may carry several namespaces, so the usual shape is one file per language for
the whole library. A gate over three of its namespaces then triggers exactly one download,
and whatever else the file contains is registered along with it.

For texts that are not files - a backend, a CMS - declare the locales and provide a loader:

```ts
textCatalog({
  namespaces: [productTexts],
  locales: ["de", "fr"],
  load: (locale) => fetch(`/api/i18n/${locale}/product`).then((r) => r.json()),
});
```

### When loading happens

Nothing is fetched at construction. A catalog load starts when a text it covers is
**read**, or when something [waits for it](#waiting-for-texts-ensure) - whichever comes
first. Reading is the low-ceremony path: the default renders, `onChange` fires when the
bundle lands, the UI re-renders with the real text.

Each `(catalog, locale)` pair is loaded at most once, and a failed load is reported to the
console and then left alone - no retry loop, and resolution simply falls through to the
namespace defaults.

### Precedence: earlier wins

`texts` is a **priority list, not a merge chain**. On a key clash the earlier entry wins,
whichever one happens to arrive first:

```ts
texts: [
  myOverrides, // wins
  datePickerCatalog,
];
```

Precedence follows the declared order rather than the order in which async loads settle, so
two bundles racing over the same key produce the same result every time.

---

## Falling back gracefully

Two kinds of fallback happen automatically, in order:

1. **Within a language** - a request for `de-CH` narrows to `de` if there's no Swiss-specific text. `zh-Hant-TW` -> `zh-TW` -> `zh`. You don't configure this; it just happens.
2. **Across languages** - the `fallbackLocales` chain. Missed everywhere in the requested language? Try the fallbacks in order.

Only when _both_ come up empty does the namespace default answer. And if even that's missing (only possible for a dynamically-keyed namespace), you get the bare key back instead of `undefined` - so a string is a string is a string.

A dynamic translation is always handed an `i18n` bound to the locale it was **actually found in**, so numbers and dates inside a German string format the German way even when German arrived via fallback.

---

## Formatting numbers, dates, and more

The full `Intl` suite, cached and shared across every instance, always bound to the current locale:

```ts
i18n.formatNumber(1234.5); // "1,234.5"
i18n.formatNumberRange(10, 20); // "10-20" (Intl separates the range with an en dash)
i18n.formatDateTime(new Date(), { dateStyle: "medium" }); // "Jul 17, 2026"
i18n.formatDateTimeRange(from, to, { dateStyle: "medium" });
i18n.formatRelativeTime(-3, "day"); // "3 days ago"
i18n.formatRelativeTime(2, "week", { numeric: "auto" }); // "in 2 weeks"
i18n.formatList(["apples", "bananas", "oranges"]); // "apples, bananas, and oranges"
i18n.formatList(["cash", "card"], { type: "disjunction" }); // "cash or card"
```

Need the raw formatter for `formatToParts` or anything the shortcuts don't cover? Every kind has an accessor: `numberFormat()`, `dateTimeFormat()`, `relativeTimeFormat()`, `listFormat()`. Working with `Temporal`? Pass the value straight to `formatDateTime` - `Intl.DateTimeFormat` handles it natively.

> Formatting is the one thing that's **deliberately not configurable** - it's a fixed, correct `Intl` core. Everything else is a swappable strategy.

---

## Switching the language

Which locale is active is a **strategy**, not a setting - picolingo never owns a "current
language" variable of its own. Where it reads from depends on where it runs:

- **In a browser**, the default source watches the live `<html lang>` attribute and
  reports every change.
- **Anywhere else** (SSR, a CLI, a test), there is no `<html>`, so you say what the locale
  is: `defaultLocaleSource({ serverSide: request.locale })` accepts a fixed tag, a getter,
  or a full source. Without one it answers `"en-US"`.

So in a browser app, switching languages is one line - and it is the line you should be
writing anyway, since screen readers, hyphenation and `:lang()` selectors all key off it:

```ts
document.documentElement.lang = "fr"; // every instance re-renders
```

Keeping the locale in your framework's state instead? Mirror it onto `<html lang>` and
you are done - no second source of truth, and the attribute stays honest:

```tsx
useEffect(() => {
  document.documentElement.lang = locale;
}, [locale]);
```

**Without a DOM**, write the source yourself. It is two methods, and picolingo does the
rest:

```ts
function appLocale(initial: string) {
  let current = initial;
  let listeners: (() => void)[] = [];
  return {
    getLocale: () => current,
    onChange: (listener: () => void) => {
      listeners.push(listener);
      return () => (listeners = listeners.filter((l) => l !== listener));
    },
    set(locale: string) {
      current = locale;
      for (const listener of [...listeners]) listener();
    },
  };
}

const locale = appLocale("de");
const runtime = setupI18n({ localeSource: locale, textSource });
locale.set("fr"); // same effect as the `<html lang>` change above
```

On a server, do not switch at all: give each request its own runtime pinned to its locale

- see [Server-side rendering](#server-side-rendering).

> **Switching into a language that is not loaded yet?** Load it first, then switch, and
> nothing flickers or suspends:
>
> ```ts
> await runtime.ensureTexts([cartTexts, checkoutTexts], "fr");
> document.documentElement.lang = "fr";
> ```

---

## Staying in sync

One runtime, one change channel - for both locale changes _and_ newly-arrived translations:

```ts
const unsubscribe = runtime.onChange(() => rerender());
// ...later
unsubscribe(); // idempotent - call it as many times as you like
```

The channel lives on the runtime, not on the facade: facades are stateless views you can
create and discard freely, while the subscription belongs to the wiring that outlives them.

Ask the current locale, or get a sibling instance pinned to another one:

```ts
i18n.locale(); // "en-US"
const de = i18n.withLocale("de"); // a sibling statically bound to German
```

Siblings share the same pipeline, caches, and change channel - they're cheap, and identical tags (`"en-US"` and `"en-us"`) return the very same instance.

---

## Does this key exist? `hasText`

```ts
// Default: is there a REAL translation from the text source, for the current locale?
// (within-language narrowing counts; fallback locales and namespace defaults do NOT.)
i18n.hasText(greetingTexts, "hello"); // boolean

// includeFallback: run the full pipeline - true whenever `text()` would return
// something meaningful rather than the bare key.
i18n.hasText(greetingTexts, "hello", true); // boolean
```

Use the first to ask "has a translator actually done this one yet?"; use the second to ask "will the user see something sensible?"

With on-demand loading in the picture, note what the question means: `hasText` reports
whether the text is **here now**, not whether it will exist. A key whose bundle is still
downloading answers `false`. That is a snapshot before a gate and reliable after one - and
in a reactive host it corrects itself, since the arriving bundle fires `onChange` and the
next render sees `true`.

---

## Dynamic keys

Sometimes the key set is open-ended - HTTP status codes, error codes, that sort of thing. Type the namespace's `defaults` with a template literal and you keep typo-protection without enumerating every value:

```ts
const httpTexts = createNamespace({
  key: "http",
  defaults: {
    "httpError.404": "Not Found",
    "httpError.500": "Internal Server Error",
  } as Record<`httpError.${number}`, string>,
});

i18n.text(httpTexts, `httpError.${code}`); // typed; unknown codes gracefully return the bare key
```

Your real defaults still work as fallbacks exactly as always - the cast only widens the _type_, never the runtime object. Want to reject nonsense like `httpError.-2.35`? Tighten the pattern to a fixed digit count:

```ts
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type HttpKey = `httpError.${Digit}${Digit}${Digit}`; // exactly three digits
```

---

## Middlewares: the friend who embellishes every story

A middleware wraps the **whole** resolution - including namespace defaults and nested lookups. That's the layer for cross-cutting concerns:

```ts
import type { TextMiddleware } from "picolingo";

// Pseudo-localization: wrap every resolved string, defaults included, for testing.
const pseudo: TextMiddleware = (req, ctx, next) => {
  const result = next();
  return result === undefined ? undefined : `[[${result}]]`;
};

// Hard-miss reporting: next() === undefined means nothing had the key - not even a default.
const reportMisses: TextMiddleware = (req, ctx, next) => {
  const result = next();
  if (result === undefined) console.warn(`i18n miss: ${req.namespace.key}/${req.key}`);
  return result;
};

const runtime = setupI18n({ middlewares: [pseudo, reportMisses] }); // index 0 is outermost
```

`next(patch)` can even rewrite the request on its way down - redirect a key, swap a namespace, anything. Short-circuit by returning without calling `next` at all.

---

## Bring your own backend

Already invested in another i18n library? A **text source** is just an object with a `resolve` function and an optional change channel:

```ts
import type { TextSource } from "picolingo";

const myAdapter: TextSource = {
  resolve: (request, context) => lookInMyBackend(request) ?? undefined, // string ("" ok) = hit, undefined = miss
  onChange: (listener) => myBackend.subscribe(listener), // optional
};

const runtime = setupI18n({ textSource: myAdapter });
```

The one rule: return `undefined` for a genuine miss - do _real_ miss detection, not a truthiness check, because `""` is a perfectly valid translation. The built-in `defaultTextSource` has no special privileges; it plugs in exactly the same way your adapter does.

### Several sources at once

`textSource` also takes a list. The first source that answers anything other than
`undefined` wins:

```ts
const runtime = setupI18n({
  textSource: [
    i18nextSource(myI18next), // the app's own texts
    defaultTextSource({ texts: [datePickerCatalog, dataGridCatalog] }), // component libraries
  ],
});
```

This is what lets an app keep an existing i18n library for its own strings and still use the
translations a component library ships, without either side knowing about the other. The
list order is also the override lever: put your own source first and it wins over a
library's text for the same key.

Each source keeps its own language-fallback policy - i18next its `fallbackLng`,
`defaultTextSource` its `fallbackLocales`. picolingo does not try to coordinate across
sources; the list order is the only cross-source rule.

---

## Waiting for texts: `ensure`

Reading a text is _reconcile-later_: something sensible renders now, the real translation
swaps in when it arrives. That is often fine. When it is not - when a flash of the default
language is worse than a short wait - a caller needs to be able to wait for exactly the
texts it is about to read. That is the optional `LoadingAware` capability, one method:

```ts
ensure(locale, namespace): Promise<void> | undefined;
```

- **`undefined`** - nothing to wait for. Either the texts are here, or there is nothing to
  load for this pair, or a previous attempt failed and was given up on.
- **a Promise** - a load is in flight. Await it, then ask again.

`ensure` also **starts** the load if none is running. That matters: a gate asks _before_
anything has read a text, so a method that could only observe would always answer "not
loading" and the gate would render defaults - the very flash it exists to prevent.

`defaultTextSource` implements it as soon as it has catalogs. An adapter over a backend can
too:

```ts
function i18nextSource(i18next: import("i18next").i18n): TextSource & LoadingAware {
  return {
    resolve: (request) =>
      i18next.exists(request.key, { ns: request.namespace.key, lng: request.locale })
        ? i18next.t(request.key, {
            ns: request.namespace.key,
            lng: request.locale,
            ...(request.params as object),
          })
        : undefined,
    ensure: (locale, namespace) =>
      i18next.hasResourceBundle(locale, namespace.key)
        ? undefined
        : // loadLanguages fetches the locale WITHOUT switching the active language -
          // never call changeLanguage here, that is a global side effect.
          i18next.loadLanguages(locale).then(() => i18next.loadNamespaces(namespace.key)),
    onChange: (listener) => {
      i18next.on("loaded", listener);
      return () => i18next.off("loaded", listener);
    },
  };
}
```

Three contract points make this safe to build on:

- **It never rejects.** A failed load resolves anyway and is final, so a Suspense boundary
  always un-suspends and resolution falls through to the namespace defaults. One broken
  locale file does not wedge the app.
- **It covers the whole resolution path** of its source - within-language narrowing and, if
  configured, the fallback locales. After awaiting it, there is nothing left that a read
  could still trigger.
- **It is optional.** A source may implement it or not. Everything that consumes it degrades
  to doing nothing when it is absent, which is the same behaviour as a source that is always
  synchronously available.

`LoadingAware` sits on the `TextSource`, not on the `I18n` facade: `I18n` is the
component-facing type and stays lean and synchronous. Callers reach it through the runtime,
which fans one call out over several namespaces:

```ts
runtime.ensureTexts([cartTexts, checkoutTexts], runtime.currentLocale());
// undefined -> render now | Promise -> await it, then render
```

That is the single method every gate is built on - `useSuspenseTexts` in React, `loading` in
the custom-element controller, or an `await` in your own binding. Since the runtime is what
the bindings distribute, a component from a third-party library can wait for its own texts
without being given the app's configuration.

One limit worth knowing: `ensure` works at **namespace** granularity, not per key. It
guarantees that the best-matching bundle for a namespace is loaded, not that every
individual key in it exists.

---

## Finding gaps

`picolingo/dev` holds two tools for the same question - _which text is not translated?_ -
answered at different moments and at different resolutions. Neither belongs in a production
bundle, which is why they live behind their own import path.

### `reportTextMisses` - while you use the app

A middleware that reports every resolution which did not come from a real translation:

```ts
import { reportTextMisses } from "picolingo/dev";

const runtime = setupI18n({
  textSource,
  middlewares: import.meta.env.DEV ? [reportTextMisses()] : [],
});
```

Click through the app in French and the console tells you what is missing, instead of you
spotting English words by eye:

```
i18n: "emptyMessage" (cart) has no translation for "fr" - using the default
i18n: "vatNotice" (checkout) fell through to the bare key - no translation, no default
```

Key-exact, so it finds single forgotten keys and mistyped ones. Each `(locale, namespace,
key)` is reported once, so re-renders do not spam. Its blind spot is the mirror image of the
other tool's: a page nobody opened stays silent.

### `textCoverage` - before anyone looks

Reads the declarations and computes which namespaces lack a translation in which locales,
without rendering or downloading anything:

```ts
import { textCoverage } from "picolingo/dev";

test("everything is translated into de and fr", () => {
  const { missing } = textCoverage(
    texts,
    ["de", "fr"],
    [cartTexts, datePickerTexts, dataGridTexts],
  );
  expect(missing).toEqual([]);
});
```

```
missing: [{ namespace: "data-grid", locale: "fr" }]
```

The point is CI: `npm update` pulls in a component library that added a namespace or dropped
a language, and the test turns red before anyone visits the page.

**The third argument is required, deliberately.** Without it the report could only check
namespaces that somebody already translated - so a component nobody ever localized would
pass silently, which is the one case you most want to hear about. The list is an inventory
the app maintains; forget an entry and that namespace goes unchecked (`reportTextMisses`
still catches it at runtime).

The default report is namespace-exact, because a catalog only declares namespaces and
locales - what is actually inside a `de.js` is unknown until it is loaded. In a test you can
afford to load:

```ts
const { missing } = await textCoverage(texts, ["de", "fr"], namespaces, { load: true });
// [{ namespace: "cart", locale: "fr", keys: ["emptyMessage", "itemCount"] }]
```

That runs every catalog's loader and compares against each namespace's defaults, so the
result is key-exact - and a partially translated language shows up as the individual keys it
is missing rather than as "present".

---

## Ask for only what you need

`I18n` is assembled from small, single-concern capability types, so a helper can depend on just the slice it uses instead of the whole facade:

```ts
import type { NumberFormatter, DateTimeFormatter } from "picolingo";

function priceLine(fmt: NumberFormatter & DateTimeFormatter, price: number, when: Date) {
  return `${fmt.formatNumber(price)} - ${fmt.formatDateTime(when)}`;
}
```

The pieces: `TextAccess`, `LocaleAware`, `ChangeNotifier`, `NumberFormatter`, `DateTimeFormatter`, `RelativeTimeFormatter`, `ListFormatter`. Pass a full `I18n` wherever any combination is expected - it satisfies them all. (`LoadingAware` is deliberately _not_ part of `I18n` - it's an optional `TextSource` capability; see [Waiting for texts](#waiting-for-texts-ensure).)

---

## Message Format (ICU)

`picolingo/message-format` gives you `msg`, a tagged template that turns an ICU MessageFormat pattern into a `TranslationFn` - a drop-in value anywhere a namespace default or a translation is expected (defaults, `someTexts`, `allTexts`).

```ts
import { createNamespace } from "picolingo";
import { msg } from "picolingo/message-format";

const cartTexts = createNamespace({
  key: "cart",
  defaults: {
    itemCount: msg<{ count: number }>`{count, plural, one {# item} other {# items}}`,
    greeting: msg<{ name: string }>`Hello, {name}!`,
  },
});

i18n.text(cartTexts, "itemCount", { count: 1 }); // "1 item"
i18n.text(cartTexts, "itemCount", { count: 3 }); // "3 items"
```

A few things worth knowing:

- The ICU syntax lives **in the string itself** - `{name}`, `{count, plural, ...}`, `{count, number}`, `{date, date, long}`, and so on go directly in the template. `${expr}` interpolation is deliberately not supported (and not needed - ICU already has its own placeholder syntax); `msg` only accepts a fully static pattern.
- The params type can't be inferred from the pattern (it's just a string to TypeScript), so name it explicitly: `` msg<{ count: number }>`...` ``.
- Formatting follows the same locale rule as everywhere else: a message resolved via cross-language fallback formats numbers/plurals/dates in the locale it was **actually found in**, not the one originally requested.
- Compiled `IntlMessageFormat` instances are cached per `(locale, pattern)` pair and reused for the life of the process.
- This entry point bundles `intl-messageformat` itself - no extra install, no peer dependency.

Anything ICU doesn't cover is still just a plain `(params, i18n) => string` - a hand-written `TranslationFn` works exactly the same way; `msg` is a convenience for the ICU dialect specifically, not a replacement for it.

---

## React

`picolingo/react` distributes the runtime through context and re-renders on every change for you. One hook - `useI18n` - hands you a lookup function `t` and a fresh `i18n` facade. Pass a namespace to scope `t` to it; pass nothing and `t` stays fully-qualified.

```tsx
import { I18nProvider, useI18n } from "picolingo/react";
import { greetingTexts } from "./greeting";

function App({ runtime }) {
  return (
    <I18nProvider runtime={runtime}>
      <Greeting name="Ada" />
    </I18nProvider>
  );
}

// Scoped: t is bound to `greetingTexts` - call t("key"[, params]) directly.
function Greeting({ name }: { name: string }) {
  const { t } = useI18n(greetingTexts);
  return <h1>{t("welcome", { name })}</h1>;
}

// Unscoped: t is fully-qualified, and i18n gives you formatting, locale(), etc.
function Clock() {
  const { t, i18n } = useI18n();
  return (
    <figure>
      <figcaption>{t(greetingTexts, "hello")}</figcaption>
      <time>{i18n.formatDateTime(new Date(), { timeStyle: "short" })}</time>
    </figure>
  );
}
```

Locale switch, lazy French bundle finishing its download - either way, the components that called `useI18n` update automatically.

`I18nProvider` does double duty from one `display: contents` wrapper: it feeds React context (for `useI18n`) **and** bridges the same runtime onto the DOM Context Community Protocol, so any web component from `picolingo/web-components` rendered inside the subtree (e.g. a Lit element using `connectI18n`) picks it up automatically - no separate wiring needed when React merely hosts custom elements. Pass a **stable** runtime (module scope, or memoized) - one created inline on every render resets the change-tracking machinery and thrashes re-rendering.

### Waiting instead of flashing: `useSuspenseTexts`

`useI18n` renders the default for one pass, then re-renders with the real translation when
it arrives. To render only real translations, wait for them first:

```tsx
import { Suspense } from "react";
import { useI18n, useSuspenseTexts } from "picolingo/react";

function LoginDialog() {
  useSuspenseTexts([dialogTexts, commonTexts, errorTexts]);
  const { t } = useI18n(dialogTexts);

  return (
    <form>
      <h1>{t("title")}</h1>
      <button>{t(commonTexts, "cancel")}</button>
      <p role="alert">{t(errorTexts, "invalidLogin")}</p>
    </form>
  );
}

function App({ runtime }) {
  return (
    <I18nProvider runtime={runtime}>
      <Suspense fallback={<DialogSkeleton />}>
        <LoginDialog />
      </Suspense>
    </I18nProvider>
  );
}
```

The hook returns nothing - it is a precondition, not an accessor. Read the texts with
`useI18n` afterwards; a `t` bound to one namespace still reaches any other via
`t(otherNamespace, "key")`.

**Pass all namespaces in one call.** Every one is asked before the first promise is thrown,
so the loads run in parallel. One hook per namespace would suspend on the first and never
reach the rest, turning one round trip into a waterfall.

**The gate can be hoisted.** Because it is separate from the read, a route can wait for the
namespaces of its whole subtree, after which the components' own gates are no-ops:

```tsx
function CheckoutRoute() {
  useSuspenseTexts([cartTexts, addressTexts, paymentTexts, commonTexts]);
  return (
    <>
      <Cart />
      <AddressForm />
      <Payment />
    </>
  );
}
```

**Load before you switch.** Changing the locale re-runs every gate, and if the new
language is not loaded yet the subtree suspends - the user watches a spinner instead of
the text that was already on screen. Wait for the namespaces first, then switch, and the
new texts simply appear:

```tsx
async function switchTo(locale: string) {
  await runtime.ensureTexts([dialogTexts, commonTexts, errorTexts], locale);
  document.documentElement.lang = locale; // or your own locale source
}
```

`startTransition` does **not** help here: `useI18n` is built on `useSyncExternalStore`,
whose updates React always treats as urgent, so the fallback appears anyway.

If the app's source cannot load on demand, the hook does nothing at all and you get the
plain `useI18n` behaviour.

### Writing a React component library

A component in a reusable library **may and generally should gate itself**. It knows which
namespaces it needs; the app does not, and a list maintained by the app would silently go
stale the moment the library adds one.

```tsx
export function DatePicker() {
  useSuspenseTexts([datePickerTexts, calendarTexts]);
  const { t } = useI18n(datePickerTexts);
  return <button>{t("today")}</button>;
}
```

The app provides the `<Suspense>` boundary - the usual React contract, the same one
`React.lazy` relies on. Two things to put in your README:

- **A boundary is required.** A component that suspends with none above it makes React throw.
  It only suspends when the app has actually enabled on-demand loading, but that is a
  plausible setup, so say so.
- **Place boundaries tightly.** When a component suspends, the nearest boundary above it
  blanks. One at the app root means half the page disappears while a button caption loads.

**Declare `picolingo` as a `peerDependency`**, not a dependency:

```jsonc
{
  "peerDependencies": { "picolingo": "^0.1.0", "react": ">=18" },
  "devDependencies": { "picolingo": "^0.1.0" },
}
```

React context does not cross package-copy boundaries. With two copies of picolingo in the
tree there are two `I18nContext` objects: the app's provider fills one, your `useI18n` reads
the other, finds nothing, and quietly falls back to the zero-config instance - defaults
forever, whatever the app configured.

For tests, `useI18n` works without a provider (you get the defaults). Wrap components in an
`I18nProvider` with a runtime holding your own catalog to test translations.

---

## Web Components

`picolingo/web-components` brings the same facade to custom elements, dependency-free (works with, but does not require, Lit), built on the [Context Community Protocol](https://github.com/webcomponents-cg/community-protocols) for distribution. Standalone elements work with zero setup thanks to namespace defaults; when you _do_ want to distribute a shared runtime, `connectI18n` attaches a reactive controller that keeps each element subscribed and re-rendering:

```ts
import { LitElement, html } from "lit";
import { connectI18n } from "picolingo/web-components";
import { greetingTexts } from "./greeting";

class GreetingBanner extends LitElement {
  #i18n = connectI18n(this, { texts: [greetingTexts] }); // ambient runtime, re-renders on change
  #t = this.#i18n.bindTexts(greetingTexts); // scoped lookup, bound once

  render() {
    return html`<h1>${this.#t("hello")}</h1>`;
  }
}
customElements.define("greeting-banner", GreetingBanner);
```

Binding `t` as a field is safe even though the controller may swap runtimes later: the
bound lookup resolves through the controller's _current_ runtime on every call, so it
follows a provider that answers late or changes its value. The same holds for a sibling
from `withLocale(locale)`.

Because every namespace carries its defaults, a `greeting-banner` dropped onto any page renders correct English immediately - even with no runtime provided at all. Provide one and it upgrades in place. `connectI18n` resolves its runtime in two stages, first match wins:

1. a context provider up the tree - re-requested on every connect, and re-subscribed live if the provider swaps runtimes
2. the internal zero-config fallback - so the element never breaks, translated or not

**Without Lit.** A plain custom element has no `addController` and no `requestUpdate`, so it
supplies both itself:

```ts
class GreetingBanner extends HTMLElement {
  #i18n = connectI18n(this, { texts: [greetingTexts], requestUpdate: () => this.#render() });

  connectedCallback() {
    this.#i18n.connect();
  }
  disconnectedCallback() {
    this.#i18n.disconnect();
  }
}
```

### Declaring texts, and the `loading` flag

`options.texts` names the namespaces the element needs. Declaring them lets the app's source
start loading at **connect** time rather than at the first text read, which is usually early
enough that nothing is ever seen in the wrong language.

There is no Suspense in the DOM - nothing can pause a render and repeat it later - so the
controller exposes `loading` instead of throwing a promise, and the element decides what to
do with it:

```ts
render() {
  if (this.#i18n.loading) return html`<slot name="placeholder"></slot>`;
  return html`<button>${this.#t("today")}</button>`;
}
```

**Most elements should not do this.** A spinner in place of a perfectly readable default
label is rarely an improvement, and the real text swaps in by itself moments later. Reach for
`loading` where the _wrong_ language is worse than a delay - legal notices, confirmations
with consequences - not for button captions.

`loading` is always `false` when no `texts` were declared, or when the app's source cannot
load on demand. Which also means: an element can never guarantee flash-free rendering on its
own. It can only make it possible; whether it happens depends on how the app wired its
source.

### Distributing a runtime

Two ways to answer a controller's context request:

**Imperative** - `provideI18n(target, runtime)` on any `EventTarget`, typically mounted once at the app root:

```ts
import { provideI18n } from "picolingo/web-components";

const stopProviding = provideI18n(document.body, appRuntime); // app-wide
// later, if you ever need to: stopProviding();
```

**Declarative** - the `<i18n-provider>` custom element, registered automatically the first time `picolingo/web-components` is imported (guarded against double registration and non-browser environments):

```ts
import "picolingo/web-components"; // registers <i18n-provider>
import { html } from "lit";

html`
  <i18n-provider .runtime=${appRuntime}>
    <greeting-banner></greeting-banner>
  </i18n-provider>
`;
```

`<i18n-provider>` is layout-neutral (`display: contents`), so it never affects your page layout. Setting `.runtime` to a new runtime re-notifies every subscribed consumer; setting it to `null` goes quiet until a value arrives again - consumers just keep waiting, they don't need to be re-mounted. A request that arrives before `.runtime` is ever set is left unclaimed, so an outer provider further up the tree can still answer it in the meantime.

The protocol's only identity mechanism is the context key, `Symbol.for("picolingo.I18nRuntime@1")`, so two copies or versions of picolingo in one bundle still find each other. The `@1` versions the value contract rather than the package: if the shape of `I18nRuntime` ever changes incompatibly, the number changes with it and an older consumer simply finds no provider - falling back to its zero-config runtime instead of calling a method that is no longer there.

---

## Server-side rendering

Two of the three pieces need nothing special; the third is left to you on purpose.

**Do not suspend on the server.** `renderToString` cannot handle Suspense at all, and
streaming SSR would send a skeleton first and patch the texts in afterwards - the wrong
trade for first paint and for crawlers. Load before rendering instead, and nothing suspends:

```ts
await runtime.ensureTexts(namespaces, locale);
renderToString(...);
```

**One source, one runtime per request.** picolingo holds no global state, so the usual
shape is a module-scope source - its store is a per-process cache, which is what you want -
and a runtime per request, pinned to that request's locale:

```ts
const source = defaultTextSource({ texts: [...] });

// per request
const runtime = setupI18n({
  localeSource: defaultLocaleSource({ serverSide: request.locale }),
  textSource: source,
});
<I18nProvider runtime={runtime}>
```

The runtime is a thin wiring object; the loaded texts live in the shared source, so a
per-request runtime costs an object and starts with everything the process already fetched.
Within one runtime, `withLocale` memoizes its siblings, so repeating it in render code
allocates nothing.

**Hydration needs one thing from you: the list.** The server rendered German; the browser
starts with nothing loaded, renders the defaults during hydration, and the text visibly
flips before the bundle lands. The fix is not to ship the texts along - translations may be
functions (every key with parameters is one), and functions do not survive JSON. Instead,
tell the client WHICH namespaces the render used and let it load those before hydrating.

Recording them is a middleware, so no extra API is needed:

```ts
function recordUsedNamespaces() {
  const used = new Set<string>();
  const middleware: TextMiddleware = (request, context, next) => {
    used.add(request.namespace.key);
    return next();
  };
  return { middleware, keys: () => [...used] };
}
```

```ts
// server, per request
const used = recordUsedNamespaces();
const runtime = setupI18n({
  localeSource: request.locale,
  textSource: source,
  middlewares: [used.middleware],
});
renderToString(...);
embedIntoHtml(used.keys()); // ["cart", "checkout"] - plain strings
```

```ts
// client, before hydrating
const wanted = allNamespaces.filter((ns) => fromServer.includes(ns.key));
await runtime.ensureTexts(wanted, document.documentElement.lang);
hydrateRoot(...); // renders exactly what the server rendered
```

`allNamespaces` is the inventory your app already maintains for
[`textCoverage`](#textcoverage---before-anyone-looks). The one part picolingo cannot do for
you is `embedIntoHtml` - a `<script>` tag, loader data, or a prop, depending on the
framework.

---

## Resolution order, in one breath

```
middlewares  ->  text source  ->  namespace defaults  ->  bare key
```

- **middlewares** wrap the _entire_ thing (they see defaults, and nested lookups).
- **text source** may be a list (first non-`undefined` answer wins) and may itself be decorated - cross-language fallback, per-source reporting - before it ever reports a miss.
- **namespace defaults** are the terminal, so they sit _inside_ the pipeline: middlewares see them too.
- **bare key** is the floor. A string always comes back; `undefined` never escapes.

---

## TypeScript setup

picolingo is written in TypeScript and ships its types. Two `tsconfig` notes:

```jsonc
{
  "compilerOptions": {
    // "es2024" provides the Intl range-formatting types (formatNumberRange / formatDateTimeRange);
    // "dom" provides MutationObserver for the client <html lang> locale source.
    "lib": ["ES2024", "DOM"],
  },
}
```

Runtime support for everything used here is solid in all current engines - the `lib` bump is purely so the _type_ definitions line up.

---

## API cheat sheet

**Create & configure**

<!-- prettier-ignore -->
| Function                                       | Purpose                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `setupI18n(config?)`                           | Wire the strategies into an `I18nRuntime`. Zero-config works. `localeSource` also takes a plain tag or getter. |
| `createI18n(runtime[, locale])`                | Derive an `I18n` facade - ambient, or bound to one locale.       |
| `createNamespace({ key, defaults })`           | Define a namespace + its default texts.                          |
| `defaultTextSource(options?)`                  | The built-in text store (`texts` list, catalogs, fallback locales). |
| `defaultLocaleSource(options?)`                | Client `<html lang>` monitor, or a server-side tag/getter.       |
| `bundleTexts(texts)`                           | Type-checked `TextBundle`, grouped by locale.                    |
| `someTexts(ns, texts)` / `allTexts(ns, texts)` | Attach partial / complete translations for one locale.           |
| `textCatalog({ namespaces, bundles })`         | Declare which namespaces/locales exist and how to load one.      |

**On the `I18n` instance**

<!-- prettier-ignore -->
| Member                                                      | Purpose                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `text(ns, key[, params])`                                   | Resolve a translation. Params are typed per key.                     |
| `hasText(ns, key, includeFallback?)`                        | Does a translation exist?                                            |
| `bindTexts([ns])`                                           | A standalone lookup, optionally scoped to a namespace.               |
| `formatNumber` / `formatNumberRange` / `numberFormat`       | Number formatting.                                                   |
| `formatDateTime` / `formatDateTimeRange` / `dateTimeFormat` | Date/time formatting.                                                |
| `formatRelativeTime` / `relativeTimeFormat`                 | Relative time ("3 days ago").                                        |
| `formatList` / `listFormat`                                 | List formatting ("a, b, and c").                                     |
| `locale()`                                                  | This facade's locale tag.                                            |
| `withLocale(locale)`                                        | A memoized sibling bound to another locale.                          |

**On the `I18nRuntime`** - the app-level object bindings distribute; everything a facade is built from

<!-- prettier-ignore -->
| Member                                             | Purpose                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `currentLocale()`                                  | The ambient locale, per the configured `LocaleSource`.                        |
| `onChange(listener)`                               | Subscribe to locale/text changes. Returns an idempotent unsubscribe.          |
| `resolveText(ns, key, params, locale)`             | The full pipeline. `undefined` is a hard miss - the bare-key policy is the facade's. |
| `hasText(ns, key, locale, includeFallback)`        | Existence, without producing the text.                                        |
| `ensureTexts([namespaces], locale)`                | The gate: starts the loads, returns a promise to await or `undefined`.        |

**`picolingo/message-format`**

<!-- prettier-ignore -->
| Export             | Purpose                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `` msg`pattern` `` | ICU MessageFormat pattern -> `TranslationFn<P>`. Specify `P` explicitly: `` msg<{ count: number }>`...` ``. |

**`picolingo/dev`** - development and CI only, never imported by production code

<!-- prettier-ignore -->
| Export                                        | Purpose                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `textCoverage(texts, locales, namespaces[, options])` | Which namespaces lack a translation in which locales. `{ load: true }` for key-exact results. |
| `reportTextMisses(options?)`                  | Middleware that logs every resolution falling through to a default or the bare key. |

**`picolingo/react`**

<!-- prettier-ignore -->
| Export                               | Purpose                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `<I18nProvider runtime>`             | Provides the runtime via React context, and bridges it to any web components in the subtree.                      |
| `useI18n(namespace?)`                | `{ i18n, t }` - `t` scoped to `namespace` if given, else fully-qualified. Re-renders on change.                   |
| `useSuspenseTexts([namespaces])`     | The gate: suspends until those namespaces have their texts. Returns nothing; read with `useI18n`.                 |

**`picolingo/web-components`**

<!-- prettier-ignore -->
| Export                                | Purpose                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `connectI18n(host, options?)`         | Reactive controller - IS an `I18n`, re-renders `host` on change. `{ texts, requestUpdate }`; exposes `loading`, `connect`, `disconnect`. |
| `provideI18n(target, runtime)`        | Imperative context-request provider on any `EventTarget`. Returns an unsubscribe.  |
| `<i18n-provider .runtime=${...}>`     | Declarative provider custom element (registered on import). Layout-neutral.        |

---

## Under the hood

Curious how it is built, or planning to contribute? **[ARCHITECTURE.md](ARCHITECTURE.md)**
covers the internals: the runtime/facade split, the three strategies, the resolution
pipeline, how the core is laid out in modules, and what each entry point adds.

---

## License

MIT (c) the Picolingo contributors
