// @vitest-environment jsdom
/**
 * Tests for the imperative `provideI18n` and the declarative `<i18n-provider>` element
 * - the two ways to answer a Context Community Protocol request - including the
 * protocol edge cases (late values, provider switching, unsubscribe identity).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { setupI18n } from "../../main/core/index.js";
import type { I18nRuntime } from "../../main/core/index.js";
import {
  I18nProviderElement,
  i18nContext,
  provideI18n,
} from "../../main/web-components/provider.js";

function createFixedLocaleRuntime(locale: string): I18nRuntime {
  return setupI18n({ localeSource: locale });
}

function mountProvider(parent: Element = document.body): I18nProviderElement {
  const provider = document.createElement("i18n-provider");
  parent.appendChild(provider);
  return provider;
}

function mountHost(parent: Element = document.body): HTMLDivElement {
  const host = document.createElement("div");
  parent.appendChild(host);
  return host;
}

/** A handcrafted protocol event (the event class itself is not exported here). */
function createContextRequest(
  callback: (value: I18nRuntime, unsubscribe?: () => void) => void,
  subscribe?: boolean,
  context: unknown = i18nContext,
): Event {
  return Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
    context,
    callback,
    subscribe,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// provideI18n
// -------------------------------------------------------------------

describe("provideI18n", () => {
  it("answers non-subscribe requests without an unsubscribe argument", () => {
    const appRuntime = createFixedLocaleRuntime("de");
    const stopProviding = provideI18n(document.body, appRuntime);
    const answers = vi.fn();

    document.body.dispatchEvent(createContextRequest(answers, undefined));
    expect(answers).toHaveBeenCalledWith(appRuntime, undefined);
    stopProviding();
  });

  it("hands subscribers a no-op unsubscribe", () => {
    const appRuntime = createFixedLocaleRuntime("de");
    const stopProviding = provideI18n(document.body, appRuntime);
    const answers = vi.fn();

    document.body.dispatchEvent(createContextRequest(answers, true));
    const [answeredI18n, unsubscribe] = answers.mock.calls[0];
    expect(answeredI18n).toBe(appRuntime);
    expect(() => unsubscribe()).not.toThrow();
    stopProviding();
  });

  it("ignores foreign contexts and events without a callback", () => {
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("de"));
    const answers = vi.fn();

    document.body.dispatchEvent(createContextRequest(answers, true, Symbol("other-context")));
    document.body.dispatchEvent(
      Object.assign(new Event("context-request", { bubbles: true }), { context: i18nContext }),
    );
    expect(answers).not.toHaveBeenCalled();
    stopProviding();
  });

  it("stops providing after the returned unsubscribe", () => {
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("de"));
    stopProviding();
    const answers = vi.fn();
    document.body.dispatchEvent(createContextRequest(answers, true));
    expect(answers).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------
// <i18n-provider>
// -------------------------------------------------------------------

describe("<i18n-provider>", () => {
  it("is registered, layout-neutral, and exposes its value", () => {
    const providerElement = mountProvider();
    expect(providerElement).toBeInstanceOf(I18nProviderElement);
    expect(providerElement.style.display).toBe("contents");
    expect(providerElement.runtime).toBeNull();

    const appRuntime = createFixedLocaleRuntime("de");
    providerElement.runtime = appRuntime;
    expect(providerElement.runtime).toBe(appRuntime);
  });

  it("answers and claims requests once a value is set", () => {
    const providerElement = mountProvider();
    providerElement.runtime = createFixedLocaleRuntime("de");
    const inner = mountHost(providerElement);
    const stopProviding = provideI18n(document.body, createFixedLocaleRuntime("en"));

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined)); // non-subscribe branch
    expect(answers).toHaveBeenCalledTimes(1);
    expect((answers.mock.calls[0][0] as I18nRuntime).currentLocale()).toBe("de"); // inner claimed, outer never saw it
    expect(answers.mock.calls[0][1]).toBeUndefined();
    stopProviding();
  });

  it("does not claim value-less non-subscribe requests (outer provider serves)", () => {
    const outerI18n = createFixedLocaleRuntime("en");
    const stopProviding = provideI18n(document.body, outerI18n);
    const providerElement = mountProvider(); // value-less
    const inner = mountHost(providerElement);

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined));
    expect(answers).toHaveBeenCalledWith(outerI18n, undefined);
    stopProviding();
  });

  it("setting the same instance again is a no-op for subscribers", () => {
    const providerElement = mountProvider();
    const inner = mountHost(providerElement);
    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true));

    const appRuntime = createFixedLocaleRuntime("de");
    providerElement.runtime = appRuntime;
    providerElement.runtime = appRuntime; // same instance -> no re-notification
    expect(answers).toHaveBeenCalledTimes(1);
  });

  it("clearing the value keeps subscribers silent until a new value arrives", () => {
    const providerElement = mountProvider();
    const inner = mountHost(providerElement);
    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true));

    providerElement.runtime = createFixedLocaleRuntime("de");
    providerElement.runtime = null; // clear: no notification, consumers keep the last value
    expect(providerElement.runtime).toBeNull();
    expect(answers).toHaveBeenCalledTimes(1);

    providerElement.runtime = createFixedLocaleRuntime("fr");
    expect(answers).toHaveBeenCalledTimes(2);
  });

  it("honors subscriber unsubscribe across value changes", () => {
    const providerElement = mountProvider();
    const inner = mountHost(providerElement);

    let latestUnsubscribe: (() => void) | undefined;
    const answers = vi.fn((_value: I18nRuntime, unsubscribe?: () => void) => {
      latestUnsubscribe = unsubscribe;
    });
    inner.dispatchEvent(createContextRequest(answers, true));

    providerElement.runtime = createFixedLocaleRuntime("de");
    expect(answers).toHaveBeenCalledTimes(1);
    latestUnsubscribe!();
    providerElement.runtime = createFixedLocaleRuntime("fr");
    expect(answers).toHaveBeenCalledTimes(1); // unsubscribed -> not notified again
  });

  it("reuses one stable subscription per callback (repeated requests)", () => {
    const providerElement = mountProvider();
    providerElement.runtime = createFixedLocaleRuntime("de");
    const inner = mountHost(providerElement);

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true));
    inner.dispatchEvent(createContextRequest(answers, true)); // e.g. reconnect
    const firstUnsubscribe = answers.mock.calls[0][1];
    const secondUnsubscribe = answers.mock.calls[1][1];
    expect(firstUnsubscribe).toBe(secondUnsubscribe);
  });

  it("stops listening after disconnect", () => {
    const outerI18n = createFixedLocaleRuntime("en");
    const stopProviding = provideI18n(document.body, outerI18n);
    const providerElement = mountProvider();
    providerElement.runtime = createFixedLocaleRuntime("de");
    const inner = mountHost(providerElement);

    providerElement.disconnectedCallback(); // force-remove listener while staying in the DOM

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined));
    expect(answers).toHaveBeenCalledWith(outerI18n, undefined); // outer serves, inner is deaf
    stopProviding();
  });

  it("reconnecting re-attaches the listener", () => {
    const providerElement = mountProvider();
    providerElement.runtime = createFixedLocaleRuntime("de");
    const inner = mountHost(providerElement);

    providerElement.remove(); // triggers disconnectedCallback
    document.body.appendChild(providerElement); // triggers connectedCallback again

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, undefined));
    expect((answers.mock.calls[0][0] as I18nRuntime).currentLocale()).toBe("de");
  });

  it("ignores foreign contexts", () => {
    const providerElement = mountProvider();
    providerElement.runtime = createFixedLocaleRuntime("de");
    const inner = mountHost(providerElement);

    const answers = vi.fn();
    inner.dispatchEvent(createContextRequest(answers, true, Symbol("other-context")));
    expect(answers).not.toHaveBeenCalled();
  });
});
