/**
 * Tests for the development tooling: `textCoverage` (declaration-based and loading)
 * and `reportTextMisses`.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createI18n,
  setupI18n,
  createNamespace,
  defaultTextSource,
  someTexts,
  textCatalog,
} from "../../main/core/index.js";
import type { TextBundle } from "../../main/core/index.js";
import { reportTextMisses, textCoverage } from "../../main/dev/index.js";

const cartTexts = createNamespace({ key: "cart", defaults: { empty: "Empty", items: "Items" } });
const gridTexts = createNamespace({ key: "grid", defaults: { sort: "Sort" } });
const untouchedTexts = createNamespace({ key: "untouched", defaults: { hi: "Hi" } });

const germanCart: TextBundle = { de: [someTexts(cartTexts, { empty: "Leer", items: "Artikel" })] };

// -------------------------------------------------------------------
// textCoverage - declarations only
// -------------------------------------------------------------------

describe("textCoverage", () => {
  it("reports a locale a catalog does not declare", () => {
    const catalog = textCatalog({
      namespaces: [cartTexts],
      locales: ["de"],
      load: () => germanCart,
    });
    const { missing, covered } = textCoverage([catalog], ["de", "fr"], [cartTexts]);
    expect(missing).toEqual([{ namespace: "cart", locale: "fr" }]);
    expect(covered).toEqual([{ namespace: "cart", locale: "de" }]);
  });

  it("reports a namespace that NOTHING contributes to - the blind spot the third argument closes", () => {
    const { missing } = textCoverage([germanCart], ["de"], [cartTexts, untouchedTexts]);
    expect(missing).toEqual([{ namespace: "untouched", locale: "de" }]);
  });

  it("reads static bundles as well as catalogs", () => {
    const catalog = textCatalog({ namespaces: [gridTexts], locales: ["de"], load: () => ({}) });
    const { missing } = textCoverage([germanCart, catalog], ["de"], [cartTexts, gridTexts]);
    expect(missing).toEqual([]);
  });

  it("counts a regional bundle for the narrowed request (de covers de-CH)", () => {
    const { missing } = textCoverage([germanCart], ["de-CH"], [cartTexts]);
    expect(missing).toEqual([]);
  });

  it("derives a catalog's locales from its bundles map", () => {
    const catalog = textCatalog({
      namespaces: [cartTexts],
      bundles: { de: () => germanCart, fr: () => ({}) },
    });
    const { missing } = textCoverage([catalog], ["de", "fr"], [cartTexts]);
    expect(missing).toEqual([]);
  });

  it("ignores a promise entry, which cannot be inspected without loading", () => {
    const { missing } = textCoverage([Promise.resolve(germanCart)], ["de"], [cartTexts]);
    expect(missing).toEqual([{ namespace: "cart", locale: "de" }]);
  });

  // -------------------------------------------------------------------
  // textCoverage - loading
  // -------------------------------------------------------------------

  it("with load: true, reports the individual keys a translation is missing", async () => {
    const catalog = textCatalog({
      namespaces: [cartTexts],
      locales: ["de"],
      load: () => ({ de: [someTexts(cartTexts, { empty: "Leer" })] }), // "items" missing
    });
    const { missing } = await textCoverage([catalog], ["de"], [cartTexts], { load: true });
    expect(missing).toEqual([{ namespace: "cart", locale: "de", keys: ["items"] }]);
  });

  it("with load: true, a complete translation is covered and promises are awaited", async () => {
    const { missing, covered } = await textCoverage(
      [Promise.resolve(germanCart)],
      ["de"],
      [cartTexts],
      { load: true },
    );
    expect(missing).toEqual([]);
    expect(covered).toEqual([{ namespace: "cart", locale: "de" }]);
  });

  it("with load: true, a catalog that has nothing for the locale is a full gap", async () => {
    const catalog = textCatalog({
      namespaces: [cartTexts],
      locales: ["de"],
      load: () => undefined,
    });
    const { missing } = await textCoverage([catalog], ["de"], [cartTexts], { load: true });
    // A FULL gap, reported without `keys`: nothing covers the pair at all, as opposed to
    // a present-but-incomplete translation.
    expect(missing).toEqual([{ namespace: "cart", locale: "de" }]);
  });
});

// -------------------------------------------------------------------
// reportTextMisses
// -------------------------------------------------------------------

describe("reportTextMisses", () => {
  const missingTexts = createNamespace({ key: "gaps", defaults: { present: "Present" } });

  function createReportingI18n(log: (message: string) => void) {
    return createI18n(
      setupI18n({
        localeSource: "fr",
        textSource: defaultTextSource({ texts: [germanCart] }),
        middlewares: [reportTextMisses({ log })],
      }),
    );
  }

  it("reports a text that falls through to its default", () => {
    const log = vi.fn();
    createReportingI18n(log).text(cartTexts, "empty");
    expect(log).toHaveBeenCalledWith(
      'i18n: "empty" (cart) has no translation for "fr" - using the default',
    );
  });

  it("stays silent for a real translation", () => {
    const log = vi.fn();
    createI18n(
      setupI18n({
        localeSource: "de",
        textSource: defaultTextSource({ texts: [germanCart] }),
        middlewares: [reportTextMisses({ log })],
      }),
    ).text(cartTexts, "empty");
    expect(log).not.toHaveBeenCalled();
  });

  it("reports a bare key separately - no translation AND no default", () => {
    const log = vi.fn();
    const i18n = createI18n(
      setupI18n({
        localeSource: "fr",
        middlewares: [reportTextMisses({ log })],
      }),
    );
    (i18n.text as (ns: unknown, key: string) => string)(missingTexts, "absent");
    expect(log).toHaveBeenCalledWith(
      'i18n: "absent" (gaps) fell through to the bare key - no translation, no default',
    );
  });

  it("reports each key only once, however often it is read", () => {
    const log = vi.fn();
    const i18n = createReportingI18n(log);
    i18n.text(cartTexts, "empty");
    i18n.text(cartTexts, "empty");
    i18n.text(cartTexts, "items");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("writes to console.warn when no log is given", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createI18n(
      setupI18n({
        localeSource: "fr",
        middlewares: [reportTextMisses()],
      }),
    ).text(cartTexts, "empty");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
