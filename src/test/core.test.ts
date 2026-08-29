/**
 * Tests for the i18n facade (node environment - the server-side branches of
 * `defaultLocaleSource` and everything that does not need a DOM).
 * The client-side branches (<html lang> monitor) live in core.dom.test.ts.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allTexts,
  bundleTexts,
  createI18n,
  createNamespace,
  defaultLocaleSource,
  defaultTextSource,
  setupI18n,
  someTexts,
  textCatalog,
} from "../main/core/index.js";

import type {
  I18n,
  I18nRuntime,
  LoadingAware,
  LocaleSource,
  TextBundle,
  TextMiddleware,
  TextSource,
} from "../main/core/index.js";

// -------------------------------------------------------------------
// Shared fixtures
// -------------------------------------------------------------------

const datePickerTexts = createNamespace({
  key: "date-picker",
  defaults: {
    today: "Today",
    range: (params: { count: number }, rangeI18n: I18n) =>
      `${rangeI18n.formatNumber(params.count)} days`,
  },
});

const greetingTexts = createNamespace({
  key: "greeting",
  defaults: { hello: "Hello" },
});

/** A locale source with a controllable locale and change channel. */
function createMutableLocaleSource(initial: string): LocaleSource & {
  setLocale(locale: string): void;
} {
  let currentLocale = initial;
  let listeners: (() => void)[] = [];
  return {
    getLocale: () => currentLocale,
    onChange: (listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((it) => it !== listener);
      };
    },
    setLocale: (locale) => {
      currentLocale = locale;
      for (const listener of [...listeners]) listener();
    },
  };
}

function createFixedLocaleRuntime(
  locale: string,
  textSource?: TextSource,
  middlewares?: TextMiddleware[],
): I18nRuntime {
  return setupI18n({ localeSource: locale, textSource, middlewares });
}

function createFixedLocaleI18n(
  locale: string,
  textSource?: TextSource,
  middlewares?: TextMiddleware[],
): I18n {
  return createI18n(createFixedLocaleRuntime(locale, textSource, middlewares));
}

const tick = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Namespaces, bundles, and runtime validation (checkTexts)
// -------------------------------------------------------------------

describe("createNamespace / someTexts / allTexts / bundleTexts", () => {
  it("creates a frozen, pure-data namespace with frozen defaults", () => {
    expect(Object.isFrozen(datePickerTexts)).toBe(true);
    expect(Object.isFrozen(datePickerTexts.defaults)).toBe(true);
    expect(datePickerTexts.key).toBe("date-picker");
    expect(datePickerTexts.defaults.today).toBe("Today");
  });

  it("copies the defaults so later mutation of the input has no effect", () => {
    const defaults: Record<string, string> = { label: "Label" };
    const copiedTexts = createNamespace({ key: "copied", defaults });
    defaults.label = "Changed";
    expect(copiedTexts.defaults.label).toBe("Label");
  });

  it("someTexts / allTexts pair the namespace with the given texts (frozen)", () => {
    const partial = someTexts(datePickerTexts, { today: "Heute" });
    expect(partial.namespace).toBe(datePickerTexts);
    expect(partial.texts).toEqual({ today: "Heute" });
    expect(Object.isFrozen(partial)).toBe(true);

    const complete = allTexts(datePickerTexts, {
      today: "Heute",
      range: (params) => `${params.count} Tage`,
    });
    expect(complete.namespace).toBe(datePickerTexts);
  });

  it("bundleTexts is the identity", () => {
    const bundle: TextBundle = { de: [someTexts(greetingTexts, { hello: "Hallo" })] };
    expect(bundleTexts(bundle)).toBe(bundle);
  });

  it("someTexts rejects unknown keys", () => {
    expect(() => someTexts(greetingTexts, { nope: "x" } as unknown as { hello?: string })).toThrow(
      /unknown keys \["nope"\]/,
    );
  });

  it("someTexts rejects a kind mismatch (string where a function is expected, and vice versa)", () => {
    expect(() =>
      someTexts(datePickerTexts, { range: "not a function" } as unknown as {
        range?: (p: { count: number }) => string;
      }),
    ).toThrow(/kind mismatches \["range" \(expected function, got string\)\]/);

    expect(() =>
      someTexts(greetingTexts, { hello: () => "x" } as unknown as { hello?: string }),
    ).toThrow(/kind mismatches \["hello" \(expected string, got function\)\]/);
  });

  it("someTexts does not require completeness", () => {
    expect(() => someTexts(datePickerTexts, { today: "Heute" })).not.toThrow();
  });

  it("allTexts requires every key and reports missing ones", () => {
    expect(() =>
      allTexts(datePickerTexts, { today: "Heute" } as unknown as Required<{
        today: string;
        range: (p: { count: number }) => string;
      }>),
    ).toThrow(/missing keys \["range"\]/);
  });

  it("treats an explicit undefined as 'not provided' (missing for allTexts, not unknown/mismatched)", () => {
    expect(() =>
      allTexts(greetingTexts, { hello: undefined } as unknown as Required<{ hello: string }>),
    ).toThrow(/missing keys \["hello"\]/);
  });

  it("reports every issue kind at once, sorted, in a single TypeError", () => {
    expect(() =>
      allTexts(datePickerTexts, {
        today: 42,
        extra: "surprise",
      } as unknown as Required<{ today: string; range: (p: { count: number }) => string }>),
    ).toThrow(
      /unknown keys \["extra"\]; kind mismatches \["today" \(expected string, got number\)\]; missing keys \["range"\]/,
    );
  });
});

// -------------------------------------------------------------------
// defaultLocaleSource (server-side branches)
// -------------------------------------------------------------------

describe("I18nConfig.localeSource shorthands", () => {
  it("accepts a fixed tag", () => {
    expect(createI18n(setupI18n({ localeSource: "de-CH" })).locale()).toBe("de-CH");
  });

  it("accepts a plain getter, re-read on every access", () => {
    let current = "de";
    const i18n = createI18n(setupI18n({ localeSource: () => current }));
    expect(i18n.locale()).toBe("de");
    current = "fr";
    expect(i18n.locale()).toBe("fr"); // no change channel, but never stale
  });

  it("still accepts a full LocaleSource, change channel included", () => {
    const mutableSource = createMutableLocaleSource("de");
    const runtime = setupI18n({ localeSource: mutableSource });
    const changes = vi.fn();
    runtime.onChange(changes);
    mutableSource.setLocale("fr");
    expect(runtime.currentLocale()).toBe("fr");
    expect(changes).toHaveBeenCalledTimes(1);
  });
});

describe("defaultLocaleSource (server)", () => {
  it("accepts a fixed tag", () => {
    const i18n = createI18n(setupI18n({ localeSource: defaultLocaleSource({ serverSide: "de" }) }));
    expect(i18n.locale()).toBe("de");
  });

  it("accepts a live getter", () => {
    let requestLocale = "fr";
    const i18n = createI18n(
      setupI18n({
        localeSource: defaultLocaleSource({ serverSide: () => requestLocale }),
      }),
    );
    expect(i18n.locale()).toBe("fr");
    requestLocale = "it";
    expect(i18n.locale()).toBe("it");
  });

  it("accepts a full LocaleSource including its change channel", () => {
    const mutableSource = createMutableLocaleSource("es");
    const runtime = setupI18n({ localeSource: defaultLocaleSource({ serverSide: mutableSource }) });
    const i18n = createI18n(runtime);
    const changes = vi.fn();
    runtime.onChange(changes);
    mutableSource.setLocale("pt");
    expect(i18n.locale()).toBe("pt");
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaultLocale without serverSide, and to en-US without options", () => {
    expect(
      createI18n(
        setupI18n({ localeSource: defaultLocaleSource({ defaultLocale: "ja" }) }),
      ).locale(),
    ).toBe("ja");
    expect(createI18n(setupI18n({ localeSource: defaultLocaleSource() })).locale()).toBe("en-US");
    expect(createI18n(setupI18n()).locale()).toBe("en-US"); // zero-config uses defaultLocaleSource()
  });
});

// -------------------------------------------------------------------
// Resolution: namespace defaults, store, tag narrowing, miss policy
// -------------------------------------------------------------------

describe("resolution", () => {
  it("resolves namespace defaults with zero config (static and dynamic)", () => {
    const i18n = createFixedLocaleI18n("de-CH");
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello");
    // dynamic default runs with the REQUESTED locale (de-CH number grouping)
    expect(i18n.text(datePickerTexts, "range", { count: 1234.5 })).toBe(
      `${new Intl.NumberFormat("de-CH").format(1234.5)} days`,
    );
  });

  it("prefers store texts over defaults and narrows tags within the language", () => {
    const i18n = createFixedLocaleI18n(
      "de-CH",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo"); // de-CH -> de
  });

  it("invokes dynamic store texts with an I18n bound to the FOUND locale", () => {
    const i18n = createFixedLocaleI18n(
      "de-CH",
      defaultTextSource({
        texts: [
          {
            de: [
              someTexts(datePickerTexts, {
                range: (params, foundI18n) => `${params.count}:${foundI18n.locale()}`,
              }),
            ],
          },
        ],
      }),
    );
    expect(i18n.text(datePickerTexts, "range", { count: 2 })).toBe("2:de");
  });

  it("treats the empty string as a valid translation", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({ texts: [{ de: [someTexts(greetingTexts, { hello: "" })] }] }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("");
  });

  it("skips dynamic values when params are missing, down to the bare key", () => {
    const looseText = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ de: [someTexts(datePickerTexts, { range: (params) => `${params.count}` })] }],
      }),
    ).text as (namespace: unknown, key: unknown, params?: unknown) => string;
    // no params: the store fn is skipped AND the default fn is skipped -> bare key
    expect(looseText(datePickerTexts, "range")).toBe("range");
  });

  it("returns the bare key for keys unknown to store AND defaults", () => {
    const looseText = createFixedLocaleI18n("de").text as (
      namespace: unknown,
      key: unknown,
    ) => string;
    expect(looseText(greetingTexts, "missing")).toBe("missing");
  });

  it("merges bundle locale keys that normalize equally (first key in the entry wins)", () => {
    const i18n = createFixedLocaleI18n(
      "de-DE",
      defaultTextSource({
        texts: [
          {
            "de-DE": [someTexts(greetingTexts, { hello: "Hallo" })],
            "de-DE-u-co-phonebk": [someTexts(greetingTexts, { hello: "Hallo!" })], // same baseName
          },
        ],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo");
  });

  it("gives an EARLIER texts entry precedence over a later one", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [
          { de: [someTexts(greetingTexts, { hello: "Override" })] },
          { de: [someTexts(greetingTexts, { hello: "Hallo" })] },
        ],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Override");
  });

  it("keeps declared precedence when a high-priority entry arrives LAST", async () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [
          Promise.resolve({ de: [someTexts(greetingTexts, { hello: "Override" })] }),
          { de: [someTexts(greetingTexts, { hello: "Hallo" })] },
        ],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo"); // only the sync entry so far
    await tick();
    expect(i18n.text(greetingTexts, "hello")).toBe("Override"); // the earlier entry displaces it
  });

  it("keeps invalid locale keys of a bundle usable as-is (normalize catch path)", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ "not a locale!!": [someTexts(greetingTexts, { hello: "Kaputt" })] }],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // unreachable entry, default wins
  });

  it("supports script subtags in the narrowing chain (zh-Hant-TW -> zh-TW -> zh)", () => {
    const i18n = createFixedLocaleI18n(
      "zh-Hant-TW",
      defaultTextSource({
        texts: [{ "zh-TW": [someTexts(greetingTexts, { hello: "你好" })] }],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("你好");
  });

  it("handles the language-less 'und' tag (chain without a language subtag)", () => {
    const i18n = createFixedLocaleI18n(
      "und",
      defaultTextSource({ texts: [{ und: [someTexts(greetingTexts, { hello: "..." })] }] }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("...");
  });

  it("applies the fallbackLocales option of defaultTextSource", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ en: [someTexts(greetingTexts, { hello: "HelloEN" })] }],
        fallbackLocales: ["en"],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("HelloEN");
  });

  it("skips a repeated fallback candidate once its normalized tag was already tried", () => {
    // "fr" (requested) misses entirely; the FIRST "es" fallback misses too and gets
    // marked seen; the SECOND "es" must be skipped as a redundant retry rather than
    // re-querying the source; "de" (last) is where the hit actually is.
    const i18n = createFixedLocaleI18n(
      "fr",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
        fallbackLocales: ["es", "es", "de"],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo");
  });

  it("falls through to the default when the requested locale AND every fallback miss", () => {
    const i18n = createFixedLocaleI18n(
      "fr",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
        fallbackLocales: ["es"],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello");
  });

  it("forwards hasText's resolveExact fast path through the fallback-locale wrapper", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
        fallbackLocales: ["en"],
      }),
    );
    expect(i18n.hasText(greetingTexts, "hello")).toBe(true);
    expect(i18n.hasText(greetingTexts, "missing")).toBe(false);
  });

  it("fails loudly at setup for an invalid fallback tag", () => {
    expect(() => defaultTextSource({ fallbackLocales: ["not a locale!!"] })).toThrow();
  });

  it("does not throw for a static default with an invalid REQUESTED locale, but formatting does", () => {
    const i18n = createFixedLocaleI18n("not a locale!!");
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // resolution degrades gracefully
    expect(() => i18n.formatNumber(1)).toThrow(); // Intl formatting stays strict
  });

  it("degrades an invalid REQUESTED locale to one opaque store candidate (buildLanguageTagChain catch)", () => {
    const i18n = createFixedLocaleI18n(
      "not a locale!!",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // opaque candidate misses the store
  });

  it("accepts a bare (non-array) namespace-texts entry for a locale, not just an array", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ de: someTexts(greetingTexts, { hello: "Hallo" }) }], // bare, no array
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo");
  });

  it("an explicit undefined value in a bundle's texts does not shadow anything", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: undefined as unknown as string })] }],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // default still wins
  });

  it("re-enters the full pipeline for nested lookups from translation functions", () => {
    const nestedTexts = createNamespace({
      key: "nested",
      defaults: {
        outer: (params: { count: number }, nestedI18n: I18n) =>
          `[${nestedI18n.text(greetingTexts, "hello")}:${params.count}]`,
      },
    });
    const i18n = createFixedLocaleI18n("de", undefined, [
      (request, _context, next) => (request.namespace.key === "greeting" ? `*${next()}*` : next()),
    ]);
    // the middleware decorates the NESTED greeting lookup made by the outer default fn
    expect(i18n.text(nestedTexts, "outer", { count: 1 })).toBe("[*Hello*:1]");
  });
});

// -------------------------------------------------------------------
// Middlewares
// -------------------------------------------------------------------

describe("middlewares", () => {
  it("run outermost-first and see texts from source AND defaults", () => {
    const order: string[] = [];
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
      [
        (request, _context, next) => {
          order.push("outer");
          return `<${next()}>`;
        },
        (request, _context, next) => {
          order.push("inner");
          return `(${next()})`;
        },
      ],
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("<(Hallo)>"); // source text decorated
    expect(i18n.text(datePickerTexts, "today")).toBe("<(Today)>"); // default text decorated
    expect(order.slice(0, 2)).toEqual(["outer", "inner"]);
  });

  it("can rewrite the request via next(patch)", () => {
    const i18n = createFixedLocaleI18n(
      "nb",
      defaultTextSource({ texts: [{ no: [someTexts(greetingTexts, { hello: "Hei" })] }] }),
      [(request, _context, next) => next(request.locale === "nb" ? { locale: "no" } : undefined)],
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hei");
  });

  it("can short-circuit without calling next", () => {
    const i18n = createFixedLocaleI18n("de", undefined, [() => "SHORT"]);
    expect(i18n.text(greetingTexts, "hello")).toBe("SHORT");
  });

  it("sees undefined from next() only on a HARD miss (no source hit, no default)", () => {
    const hardMisses: string[] = [];
    const i18n = createFixedLocaleI18n("de", undefined, [
      (request, _context, next) => {
        const resolved = next();
        if (resolved === undefined) hardMisses.push(request.key);
        return resolved;
      },
    ]);
    const looseText = i18n.text as (namespace: unknown, key: unknown) => string;
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // default -> not a hard miss
    expect(looseText(greetingTexts, "missing")).toBe("missing");
    expect(hardMisses).toEqual(["missing"]);
  });
});

// -------------------------------------------------------------------
// defaultTextSource: async inputs
// -------------------------------------------------------------------

describe("defaultTextSource (async inputs)", () => {
  it("registers promise bundles when they settle and notifies", async () => {
    let resolveBundle!: (bundle: TextBundle) => void;
    const pendingBundle = new Promise<TextBundle>((resolvePromise) => {
      resolveBundle = resolvePromise;
    });
    const runtime = createFixedLocaleRuntime("de", defaultTextSource({ texts: [pendingBundle] }));
    const i18n = createI18n(runtime);
    const changes = vi.fn();
    runtime.onChange(changes);

    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // default until it lands
    resolveBundle({ de: [someTexts(greetingTexts, { hello: "Hallo" })] });
    await tick();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo");
  });

  it("does not notify for a settled bundle that adds nothing", async () => {
    const runtime = createFixedLocaleRuntime(
      "de",
      defaultTextSource({ texts: [Promise.resolve({} as TextBundle)] }),
    );
    const changes = vi.fn();
    runtime.onChange(changes);
    await tick();
    expect(changes).not.toHaveBeenCalled();
  });

  it("does not load a catalog until something asks for it", () => {
    const load = vi.fn(() => ({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }));
    defaultTextSource({
      texts: [textCatalog({ namespaces: [greetingTexts], locales: ["de"], load })],
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads a catalog on the first READ and swaps the text in when it lands", async () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [
          textCatalog({
            namespaces: [greetingTexts],
            locales: ["de"],
            load: () => Promise.resolve({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }),
          }),
        ],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello"); // default, and starts the load
    await tick();
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo");
  });

  it("loads each (catalog, tag) pair only once, however often it is asked", async () => {
    const load = vi.fn(() =>
      Promise.resolve({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }),
    );
    const source = defaultTextSource({
      texts: [textCatalog({ namespaces: [greetingTexts], locales: ["de"], load })],
    }) as TextSource & LoadingAware;
    await source.ensure("de", greetingTexts);
    await source.ensure("de", greetingTexts);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("warns when a catalog claims a namespace its bundle does not carry", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = defaultTextSource({
      texts: [
        textCatalog({
          namespaces: [greetingTexts, datePickerTexts], // claims two ...
          locales: ["de"],
          load: () => ({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }), // ... delivers one
        }),
      ],
    }) as TextSource & LoadingAware;
    await source.ensure("de", greetingTexts);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('"date-picker"'));
    consoleWarn.mockRestore();
  });

  it("stays quiet when a catalog delivers everything it claims", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = defaultTextSource({
      texts: [
        textCatalog({
          namespaces: [greetingTexts],
          locales: ["de"],
          load: () => ({ de: [someTexts(greetingTexts, { hello: "Hallo" })] }),
        }),
      ],
    }) as TextSource & LoadingAware;
    await source.ensure("de", greetingTexts);
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("reports a rejected load via console.error and gives up on it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn(() => Promise.reject(new Error("load failed")));
    const source = defaultTextSource({
      texts: [
        Promise.reject(new Error("bundle failed")),
        textCatalog({ namespaces: [greetingTexts], locales: ["de"], load }),
      ],
    }) as TextSource & LoadingAware;
    await source.ensure("de", greetingTexts);
    await tick();
    await source.ensure("de", greetingTexts); // final: no retry
    expect(load).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("unsubscribing from the source change channel is idempotent", () => {
    const source = defaultTextSource();
    const unsubscribe = source.onChange!(vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("with no texts at all, resolves straight to the defaults", () => {
    const i18n = createFixedLocaleI18n("de", defaultTextSource());
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello");
  });
});

// -------------------------------------------------------------------
// hasText
// -------------------------------------------------------------------

describe("hasText", () => {
  const textSource = defaultTextSource({
    texts: [
      {
        de: [
          someTexts(greetingTexts, { hello: "Hallo" }),
          someTexts(datePickerTexts, { range: (p) => `${p.count} Tage` }),
        ],
      },
    ],
  });

  it("includeFallback: false (default) - true only for a real store hit in the current locale", () => {
    const i18n = createFixedLocaleI18n("de-CH", textSource); // narrows de-CH -> de
    expect(i18n.hasText(greetingTexts, "hello")).toBe(true);
    expect(i18n.hasText(greetingTexts, "hello", false)).toBe(true);
    expect(i18n.hasText(datePickerTexts, "today")).toBe(false); // only in defaults, not the source
  });

  it("includeFallback: true - true whenever text() would return something other than the bare key", () => {
    const i18n = createFixedLocaleI18n("de", textSource);
    expect(i18n.hasText(greetingTexts, "hello", true)).toBe(true); // source hit
    expect(i18n.hasText(datePickerTexts, "today", true)).toBe(true); // default hit
    const looseHasText = i18n.hasText as (
      namespace: unknown,
      key: unknown,
      full?: boolean,
    ) => boolean;
    expect(looseHasText(greetingTexts, "missing", true)).toBe(false); // hard miss
  });

  it("a dynamic (function) key counts for both hasText modes - existence, not production", () => {
    const i18n = createFixedLocaleI18n("de", textSource);
    expect(i18n.hasText(datePickerTexts, "range", false)).toBe(true);
    // Existence, not production: the key has a translation function, and `hasText`
    // reports it without inventing params to invoke it with.
    expect(i18n.hasText(datePickerTexts, "range", true)).toBe(true);
  });

  it("is false with no textSource configured at all", () => {
    const i18n = createFixedLocaleI18n("de");
    expect(i18n.hasText(greetingTexts, "hello")).toBe(false);
    expect(i18n.hasText(greetingTexts, "hello", true)).toBe(true); // falls through to the default
  });

  it("is false (includeFallback: false) when the textSource has no resolveExact fast path", () => {
    const minimalSource: TextSource = {
      resolve: (request) =>
        request.namespace.key === "greeting" && request.key === "hello" ? "Hallo" : undefined,
    };
    const i18n = createFixedLocaleI18n("de", minimalSource);
    expect(i18n.text(greetingTexts, "hello")).toBe("Hallo"); // resolve still works
    expect(i18n.hasText(greetingTexts, "hello")).toBe(false); // no resolveExact -> can't answer
  });
});

// -------------------------------------------------------------------
// The facade: reactivity, siblings, formatters, bindTexts
// -------------------------------------------------------------------

describe("I18n facade", () => {
  it("withLocale() binds a sibling to the requested tag, exactly as passed", () => {
    const i18n = createFixedLocaleI18n("de");
    expect(i18n.withLocale("fr").locale()).toBe("fr");
    expect(i18n.withLocale("en-US-u-nu-arab").locale()).toBe("en-US-u-nu-arab");
    expect(Object.isFrozen(i18n)).toBe(true);
  });

  it("withLocale() memoizes siblings per runtime, and de-duplicates case-only variants", () => {
    const i18n = createFixedLocaleI18n("de");
    expect(i18n.withLocale("fr")).toBe(i18n.withLocale("fr"));
    expect(i18n.withLocale("en-US")).toBe(i18n.withLocale("en-us"));
    // A sibling of a sibling is the same object - they share the runtime's cache.
    expect(i18n.withLocale("fr").withLocale("fr")).toBe(i18n.withLocale("fr"));
  });

  it("createI18n() always creates: a fresh identity per call, on purpose", () => {
    const runtime = createFixedLocaleRuntime("de");
    expect(createI18n(runtime, "fr")).not.toBe(createI18n(runtime, "fr"));
    expect(createI18n(runtime, "fr").text(greetingTexts, "hello")).toBe(
      createI18n(runtime, "fr").text(greetingTexts, "hello"),
    );
  });

  it("withLocale() tolerates an invalid tag (canonicalLocale catch path) without throwing", () => {
    const i18n = createFixedLocaleI18n("de");
    expect(() => i18n.withLocale("not a locale!!")).not.toThrow();
    expect(i18n.withLocale("not a locale!!").locale()).toBe("not a locale!!");
  });

  it("a bound sibling keeps its locale while the ambient one moves on", () => {
    const mutableSource = createMutableLocaleSource("de");
    const runtime = setupI18n({ localeSource: mutableSource });
    const i18n = createI18n(runtime);
    const french = i18n.withLocale("fr");
    const changes = vi.fn();
    runtime.onChange(changes); // the change channel lives on the runtime
    mutableSource.setLocale("en");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(i18n.locale()).toBe("en");
    expect(french.locale()).toBe("fr");
  });

  it("onChange unsubscribe removes the listener and is idempotent", () => {
    const mutableSource = createMutableLocaleSource("de");
    const runtime = setupI18n({ localeSource: mutableSource });
    const changes = vi.fn();
    const unsubscribe = runtime.onChange(changes);
    unsubscribe();
    unsubscribe();
    mutableSource.setLocale("en");
    expect(changes).not.toHaveBeenCalled();
  });

  it("notifies once when both locale AND texts change in the same tick", () => {
    const mutableSource = createMutableLocaleSource("de");
    const textListeners: (() => void)[] = [];
    const textSource: TextSource = {
      resolve: () => undefined,
      onChange: (listener) => {
        textListeners.push(listener);
        return () => undefined;
      },
    };
    const runtime = setupI18n({ localeSource: mutableSource, textSource });
    const changes = vi.fn();
    runtime.onChange(changes);
    mutableSource.setLocale("en");
    for (const listener of textListeners) listener();
    expect(changes).toHaveBeenCalledTimes(2); // both channels feed the same listener set
  });

  it("formats numbers, dates, ranges, relative time, and lists in the active locale, with shared caches", () => {
    const i18n = createFixedLocaleI18n("de-DE");
    expect(i18n.formatNumber(1234.5)).toBe(new Intl.NumberFormat("de-DE").format(1234.5));
    expect(i18n.formatNumberRange(1, 5)).toBe(new Intl.NumberFormat("de-DE").formatRange(1, 5));

    const someDate = new Date(Date.UTC(2026, 0, 2));
    const otherDate = new Date(Date.UTC(2026, 0, 10));
    expect(i18n.formatDateTime(someDate, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(someDate),
    );
    expect(i18n.formatDateTimeRange(someDate, otherDate, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).formatRange(someDate, otherDate),
    );

    expect(i18n.formatRelativeTime(-3, "day")).toBe(
      new Intl.RelativeTimeFormat("de-DE").format(-3, "day"),
    );
    expect(i18n.formatList(["a", "b"])).toBe(new Intl.ListFormat("de-DE").format(["a", "b"]));

    // identity: same options -> same instance; key order must not matter
    expect(i18n.numberFormat({ style: "currency", currency: "EUR" })).toBe(
      i18n.numberFormat({ currency: "EUR", style: "currency" }),
    );
    expect(i18n.dateTimeFormat({ timeZone: "UTC", year: "numeric" })).toBe(
      i18n.dateTimeFormat({ year: "numeric", timeZone: "UTC" }),
    );
    expect(i18n.relativeTimeFormat({ numeric: "auto" })).toBe(
      i18n.relativeTimeFormat({ numeric: "auto" }),
    );
    expect(i18n.listFormat({ type: "disjunction" })).toBe(i18n.listFormat({ type: "disjunction" }));
    // options-less variants hit the empty cache key
    expect(i18n.numberFormat()).toBe(i18n.numberFormat());
    expect(i18n.dateTimeFormat()).toBe(i18n.dateTimeFormat());
    expect(i18n.relativeTimeFormat()).toBe(i18n.relativeTimeFormat());
    expect(i18n.listFormat()).toBe(i18n.listFormat());
    // different locales get different formatters
    expect(i18n.withLocale("fr").numberFormat()).not.toBe(i18n.numberFormat());
    // different kinds never collide even with an equivalent-looking cache key
    expect(i18n.numberFormat() as unknown).not.toBe(i18n.dateTimeFormat() as unknown);
  });

  it("bindTexts without a namespace is exactly text()", () => {
    const i18n = createFixedLocaleI18n("de");
    const lookupText = i18n.bindTexts();
    expect(lookupText(greetingTexts, "hello")).toBe("Hello");
    expect(lookupText(datePickerTexts, "range", { count: 2 })).toBe("2 days");
  });

  it("bindTexts with a namespace scopes it and still accepts fully-qualified calls", () => {
    const i18n = createFixedLocaleI18n(
      "de",
      defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    );
    const greetingLookup = i18n.bindTexts(greetingTexts);
    expect(greetingLookup("hello")).toBe("Hallo"); // scoped
    expect(greetingLookup(datePickerTexts, "today")).toBe("Today"); // fully-qualified escape
    expect(greetingLookup(datePickerTexts, "range", { count: 4 })).toBe("4 days");
  });
});

// -------------------------------------------------------------------
// Composing several text sources
// -------------------------------------------------------------------

describe("textSource as a list", () => {
  const appSource: TextSource = {
    resolve: (request) => (request.key === "hello" ? "App-Hallo" : undefined),
  };
  const librarySource: TextSource = {
    resolve: (request) => (request.key === "hello" ? "Lib-Hallo" : undefined),
  };

  it("lets the FIRST source that answers win", () => {
    const i18n = createI18n(
      setupI18n({
        localeSource: "de",
        textSource: [appSource, librarySource],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("App-Hallo");
  });

  it("falls through a source that misses", () => {
    const i18n = createI18n(
      setupI18n({
        localeSource: "de",
        textSource: [{ resolve: () => undefined }, librarySource],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Lib-Hallo");
  });

  it("falls through to the namespace defaults when every source misses", () => {
    const i18n = createI18n(
      setupI18n({
        localeSource: "de",
        textSource: [{ resolve: () => undefined }, { resolve: () => undefined }],
      }),
    );
    expect(i18n.text(greetingTexts, "hello")).toBe("Hello");
  });

  it("merges the change channels, so a load in ANY member notifies", async () => {
    const first = defaultTextSource({
      texts: [Promise.resolve({ de: [someTexts(greetingTexts, { hello: "Eins" })] })],
    });
    const second = defaultTextSource({
      texts: [Promise.resolve({ de: [someTexts(datePickerTexts, { today: "Heute" })] })],
    });
    const runtime = setupI18n({
      localeSource: "de",
      textSource: [first, second],
    });
    const i18n = createI18n(runtime);
    const changes = vi.fn();
    runtime.onChange(changes);

    await tick();
    expect(changes).toHaveBeenCalledTimes(2); // once per member
    expect(i18n.text(greetingTexts, "hello")).toBe("Eins");
    expect(i18n.text(datePickerTexts, "today")).toBe("Heute");
  });

  it("unsubscribing from the composed channel detaches every member", async () => {
    const source = defaultTextSource({
      texts: [Promise.resolve({ de: [someTexts(greetingTexts, { hello: "Eins" })] })],
    });
    const runtime = setupI18n({
      localeSource: "de",
      textSource: [source, defaultTextSource()],
    });
    const changes = vi.fn();
    runtime.onChange(changes)();
    await tick();
    expect(changes).not.toHaveBeenCalled();
  });

  it("forwards resolveExact to the first source that has an answer", () => {
    const exactSource: TextSource = {
      resolve: () => undefined,
      resolveExact: (_locale, _namespace, key) => (key === "hello" ? "Hallo" : undefined),
    };
    const i18n = createI18n(
      setupI18n({
        localeSource: "de",
        textSource: [{ resolve: () => undefined }, exactSource],
      }),
    );
    expect(i18n.hasText(greetingTexts, "hello")).toBe(true);
  });

  it("fans `ensure` out to every member that can load, and skips those that cannot", async () => {
    const asked: string[] = [];
    const awaitable: TextSource & LoadingAware = {
      resolve: () => undefined,
      ensure: (locale) => {
        asked.push(locale);
        return Promise.resolve();
      },
    };
    const plain: TextSource = { resolve: () => undefined };
    const runtime = setupI18n({
      localeSource: "de",
      textSource: [plain, awaitable],
    });
    // The gate goes through the runtime, exactly as every binding does.
    await runtime.ensureTexts([greetingTexts], "de");
    expect(asked).toEqual(["de"]);
  });

  it("reports nothing to wait for when no member can load", () => {
    const runtime = setupI18n({
      localeSource: "de",
      textSource: [{ resolve: () => undefined }, { resolve: () => undefined }],
    });
    expect(runtime.ensureTexts([greetingTexts], "de")).toBeUndefined();
  });
});
