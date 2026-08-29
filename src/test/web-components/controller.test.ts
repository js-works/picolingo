// @vitest-environment jsdom
/**
 * Tests for the reactive controller (`connectI18n`): runtime resolution order,
 * reactivity, delegation of the full I18n surface, and the protocol edge cases (late
 * values, provider switching, unsubscribe identity).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  setupI18n,
  createNamespace,
  defaultTextSource,
  someTexts,
  textCatalog,
} from "../../main/core/index.js";
import type { I18n, I18nRuntime, LocaleSource, TextBundle } from "../../main/core/index.js";
import { connectI18n } from "../../main/web-components/controller.js";
import {
  provideI18n,
  i18nContext,
  I18nProviderElement,
} from "../../main/web-components/provider.js";
import type { I18nController } from "../../main/web-components/controller.js";

const greetingTexts = createNamespace({ key: "greeting", defaults: { hello: "Hello" } });
const datePickerTexts = createNamespace({
  key: "date-picker",
  defaults: {
    today: "Today",
    range: (params: { count: number }, rangeI18n: I18n) =>
      `${rangeI18n.formatNumber(params.count)} days`,
  },
});

function createFixedLocaleRuntime(locale: string): I18nRuntime {
  return setupI18n({ localeSource: locale });
}

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

/** A minimal Lit-style host element. */
class TestHostElement extends HTMLElement {
  requestUpdate = vi.fn();
  controllers: I18nController[] = [];
  addController(controller: I18nController): void {
    this.controllers.push(controller);
  }
}
customElements.define("test-host", TestHostElement);

function mountHost(parent: Element = document.body): TestHostElement {
  const host = document.createElement("test-host") as TestHostElement;
  parent.appendChild(host);
  return host;
}

function mountProvider(parent: Element = document.body): I18nProviderElement {
  const provider = document.createElement("i18n-provider");
  parent.appendChild(provider);
  return provider;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("connectI18n", () => {
  it("registers itself with the host and is frozen", () => {
    const host = mountHost();
    const controllerI18n = connectI18n(host);
    expect(host.controllers).toEqual([controllerI18n]);
    expect(Object.isFrozen(controllerI18n)).toBe(true);
  });

  it("serves a plain custom element: own requestUpdate, manual connect/disconnect", () => {
    const mutableSource = createMutableLocaleSource("fr");
    const stopProviding = provideI18n(document.body, setupI18n({ localeSource: mutableSource }));
    const plainHost = document.createElement("div"); // no addController, no requestUpdate
    document.body.appendChild(plainHost);
    const render = vi.fn();

    const controllerI18n = connectI18n(plainHost, { requestUpdate: render });
    controllerI18n.connect();
    expect(controllerI18n.locale()).toBe("fr"); // context request works from any EventTarget

    render.mockClear();
    mutableSource.setLocale("es");
    expect(render).toHaveBeenCalledTimes(1); // the supplied callback stands in for Lit's
    expect(controllerI18n.locale()).toBe("es");

    controllerI18n.disconnect();
    mutableSource.setLocale("pt");
    expect(render).toHaveBeenCalledTimes(1); // unsubscribed
    stopProviding();
  });

  it("falls back to the internal zero-config instance without any provider", () => {
    document.documentElement.setAttribute("lang", "it");
    const host = mountHost();
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.locale()).toBe("it"); // <html lang> via zero-config fallback
    expect(controllerI18n.text(greetingTexts, "hello")).toBe("Hello");
  });

  it("shares one internal fallback runtime across independent controllers", () => {
    document.documentElement.setAttribute("lang", "pt");
    const controllerA = connectI18n(mountHost());
    const controllerB = connectI18n(mountHost());
    controllerA.hostConnected();
    controllerB.hostConnected();
    // Same ambient locale source, same defaults - both sit on the one fallback runtime.
    expect(controllerA.locale()).toBe("pt");
    expect(controllerB.locale()).toBe(controllerA.locale());
    document.documentElement.removeAttribute("lang");
  });

  it("adopts an instance provided up the tree on connect", () => {
    const appI18n = createFixedLocaleRuntime("fr");
    const stopProviding = provideI18n(document.body, appI18n);
    const host = mountHost();

    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.locale()).toBe("fr");
    stopProviding();
  });

  it("re-renders the host on locale and text changes of the current instance", () => {
    const mutableSource = createMutableLocaleSource("de");
    const host = mountHost();
    const providerElement = mountProvider();
    providerElement.runtime = setupI18n({ localeSource: mutableSource });
    host.remove();
    providerElement.appendChild(host);
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    host.requestUpdate.mockClear(); // adopting the provider runtime already re-rendered once

    mutableSource.setLocale("en");
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
    expect(controllerI18n.locale()).toBe("en");
  });

  it("stops re-rendering and unsubscribes from the provider on disconnect", () => {
    const mutableSource = createMutableLocaleSource("de");
    const providerElement = mountProvider();
    providerElement.runtime = setupI18n({ localeSource: mutableSource });
    const host = mountHost(providerElement);

    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.locale()).toBe("de");
    host.requestUpdate.mockClear(); // adopting the provider instance already re-rendered once

    controllerI18n.hostDisconnected();
    mutableSource.setLocale("en"); // change subscription must be gone
    expect(host.requestUpdate).not.toHaveBeenCalled();

    providerElement.runtime = createFixedLocaleRuntime("fr"); // provider subscription must be gone
    expect(controllerI18n.locale()).toBe("en"); // still the OLD instance's (live) locale
  });

  it("delegates the full I18n surface to the current instance", () => {
    const host = mountHost();
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("de-DE"));
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();

    expect(controllerI18n.formatNumber(1234.5)).toBe(new Intl.NumberFormat("de-DE").format(1234.5));
    expect(controllerI18n.formatNumberRange(1, 5)).toBe(
      new Intl.NumberFormat("de-DE").formatRange(1, 5),
    );
    expect(controllerI18n.numberFormat()).toBe(controllerI18n.numberFormat()); // shared cache

    const someDate = new Date(Date.UTC(2026, 0, 2));
    const otherDate = new Date(Date.UTC(2026, 0, 10));
    expect(controllerI18n.formatDateTime(someDate, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(someDate),
    );
    expect(controllerI18n.formatDateTimeRange(someDate, otherDate, { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).formatRange(someDate, otherDate),
    );
    expect(controllerI18n.dateTimeFormat({ timeZone: "UTC" }).resolvedOptions().timeZone).toBe(
      "UTC",
    );

    expect(controllerI18n.formatRelativeTime(-3, "day")).toBe(
      new Intl.RelativeTimeFormat("de-DE").format(-3, "day"),
    );
    expect(controllerI18n.relativeTimeFormat()).toBe(controllerI18n.relativeTimeFormat());

    expect(controllerI18n.formatList(["a", "b"])).toBe(
      new Intl.ListFormat("de-DE").format(["a", "b"]),
    );
    expect(controllerI18n.listFormat()).toBe(controllerI18n.listFormat());

    expect(controllerI18n.text(datePickerTexts, "range", { count: 2 })).toBe("2 days");
    expect(controllerI18n.hasText(greetingTexts, "hello")).toBe(false); // no textSource configured
    expect(controllerI18n.hasText(greetingTexts, "hello", true)).toBe(true); // default hit
    expect(controllerI18n.withLocale("fr").locale()).toBe("fr");
    stopProviding();
  });

  it("bindTexts delegates lazily: bound lookups follow a provider switch", () => {
    const providerElement = mountProvider();
    const host = mountHost(providerElement);
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();

    const unboundLookup = controllerI18n.bindTexts();
    const greetingLookup = controllerI18n.bindTexts(greetingTexts);
    expect(unboundLookup(greetingTexts, "hello")).toBe("Hello");
    expect(greetingLookup("hello")).toBe("Hello");
    expect(greetingLookup(datePickerTexts, "range", { count: 3 })).toBe("3 days"); // fully-qualified

    // switch the instance via the provider: previously bound lookups must follow
    providerElement.runtime = createFixedLocaleRuntime("fr-CH");
    expect(controllerI18n.locale()).toBe("fr-CH");
    expect(greetingLookup(datePickerTexts, "range", { count: 1234.5 })).toBe(
      `${new Intl.NumberFormat("fr-CH").format(1234.5)} days`,
    );
  });

  it("hands out lookups and siblings that survive a provider switch", () => {
    const providerElement = mountProvider();
    const host = mountHost(providerElement);
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();

    // Both taken BEFORE any provider answered, as class fields would be.
    const t = controllerI18n.bindTexts(greetingTexts);
    const german = controllerI18n.withLocale("de-DE");
    expect(german.formatNumber(1234.5)).toBe(new Intl.NumberFormat("de-DE").format(1234.5));

    providerElement.runtime = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    });

    expect(t("hello")).toBe("Hallo"); // the bound lookup followed the switch
    expect(german.text(greetingTexts, "hello")).toBe("Hallo"); // and so did the sibling
    expect(german.locale()).toBe("de-DE"); // still bound to its own locale
  });

  it("follows repeated provider value changes (stable unsubscribe identity)", () => {
    const providerElement = mountProvider();
    const host = mountHost(providerElement);
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();

    providerElement.runtime = createFixedLocaleRuntime("de");
    expect(controllerI18n.locale()).toBe("de");
    providerElement.runtime = createFixedLocaleRuntime("fr");
    expect(controllerI18n.locale()).toBe("fr");
    providerElement.runtime = createFixedLocaleRuntime("es"); // regression: third switch still works
    expect(controllerI18n.locale()).toBe("es");
    expect(host.requestUpdate).toHaveBeenCalledTimes(3);
  });

  it("keeps a `t` bound before a swap pointing at the CURRENT instance", () => {
    const providerElement = mountProvider();
    const host = mountHost(providerElement);
    const controllerI18n = connectI18n(host, { texts: [greetingTexts] });
    // Bound once, as a class field would be - before any provider has answered.
    const t = controllerI18n.bindTexts(greetingTexts);
    controllerI18n.hostConnected();
    expect(t("hello")).toBe("Hello"); // zero-config fallback

    providerElement.runtime = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({
        texts: [{ de: [someTexts(greetingTexts, { hello: "Hallo" })] }],
      }),
    });
    expect(t("hello")).toBe("Hallo"); // same `t`, new instance
  });

  it("keeps the latest answer when an inner provider arrives after an outer one", () => {
    const outerI18n = createFixedLocaleRuntime("en");
    const stopProviding = provideI18n(document.body, outerI18n);
    const innerProvider = mountProvider(); // no value yet -> does not claim requests
    const host = mountHost(innerProvider);

    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.locale()).toBe("en"); // outer served meanwhile

    innerProvider.runtime = createFixedLocaleRuntime("de"); // late inner value wins
    expect(controllerI18n.locale()).toBe("de");
    stopProviding();
  });

  it("re-adopts the same instance on reconnect without re-rendering", () => {
    const providerElement = mountProvider();
    providerElement.runtime = createFixedLocaleRuntime("de");
    const host = mountHost(providerElement);
    const controllerI18n = connectI18n(host);

    controllerI18n.hostConnected();
    controllerI18n.hostDisconnected();
    host.requestUpdate.mockClear();

    controllerI18n.hostConnected(); // provider re-answers with the SAME instance
    expect(controllerI18n.locale()).toBe("de");
    expect(host.requestUpdate).not.toHaveBeenCalled(); // switchTo(same) is a no-op
  });

  it("adopts a late answer while disconnected without touching the host", () => {
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("en"));
    const innerProvider = mountProvider(); // value-less: subscription survives disconnect
    const host = mountHost(innerProvider);
    const controllerI18n = connectI18n(host);

    controllerI18n.hostConnected(); // outer answers; inner remembers the subscriber
    controllerI18n.hostDisconnected();
    host.requestUpdate.mockClear();

    innerProvider.runtime = createFixedLocaleRuntime("de"); // late answer while disconnected
    expect(controllerI18n.locale()).toBe("de"); // adopted for the next connect
    expect(host.requestUpdate).not.toHaveBeenCalled(); // but no render while disconnected
    stopProviding();
  });

  it("tolerates minimal providers that answer subscribe requests without unsubscribe", () => {
    const bareRuntime = createFixedLocaleRuntime("pt");
    const bareProvider = (event: Event): void => {
      const request = event as Event & {
        context?: unknown;
        callback?: (value: I18nRuntime) => void;
      };
      if (request.context === i18nContext && request.callback) {
        event.stopPropagation();
        request.callback(bareRuntime); // no unsubscribe at all
      }
    };
    document.body.addEventListener("context-request", bareProvider);
    const host = mountHost();
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.locale()).toBe("pt");
    expect(() => controllerI18n.hostDisconnected()).not.toThrow();
    document.body.removeEventListener("context-request", bareProvider);
  });
});

// -------------------------------------------------------------------
// Loading state - the DOM has no Suspense, so the component renders around `loading`
// -------------------------------------------------------------------

describe("connectI18n loading", () => {
  const germanGreeting: TextBundle = { de: [someTexts(greetingTexts, { hello: "Hallo" })] };

  /** A catalog whose single load is released by hand. */
  function createControllableCatalog() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const catalog = textCatalog({
      namespaces: [greetingTexts],
      locales: ["de"],
      load: async () => {
        await gate;
        return germanGreeting;
      },
    });
    return { catalog, release };
  }

  it("is false when no texts were declared", () => {
    const host = mountHost();
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("de"));
    const controllerI18n = connectI18n(host);
    controllerI18n.hostConnected();
    expect(controllerI18n.loading).toBe(false);
    stopProviding();
  });

  it("is false when the source cannot load on demand", () => {
    const host = mountHost();
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("de"));
    const controllerI18n = connectI18n(host, { texts: [greetingTexts] });
    controllerI18n.hostConnected();
    expect(controllerI18n.loading).toBe(false);
    stopProviding();
  });

  it("starts the load at CONNECT time and clears itself when the texts land", async () => {
    const { catalog, release } = createControllableCatalog();
    const appRuntime = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({ texts: [catalog] }),
    });
    const stopProviding = provideI18n(document.body, appRuntime);
    const host = mountHost();
    const controllerI18n = connectI18n(host, { texts: [greetingTexts] });

    controllerI18n.hostConnected();
    expect(controllerI18n.loading).toBe(true); // nothing was read yet - declaring sufficed
    expect(controllerI18n.text(greetingTexts, "hello")).toBe("Hello"); // default meanwhile

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controllerI18n.loading).toBe(false);
    expect(controllerI18n.text(greetingTexts, "hello")).toBe("Hallo");
    expect(host.requestUpdate).toHaveBeenCalled();
    stopProviding();
  });

  it("re-renders the host when the loading flag flips", async () => {
    const { catalog, release } = createControllableCatalog();
    const appRuntime = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({ texts: [catalog] }),
    });
    const stopProviding = provideI18n(document.body, appRuntime);
    const host = mountHost();
    const controllerI18n = connectI18n(host, { texts: [greetingTexts] });
    controllerI18n.hostConnected();
    host.requestUpdate.mockClear();

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.requestUpdate).toHaveBeenCalled();
    stopProviding();
  });
});
