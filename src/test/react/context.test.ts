// @vitest-environment jsdom
/**
 * Tests for the React bindings: `I18nProvider` (React context + DOM Context
 * Community Protocol bridge) and `useI18n` (reactive snapshot + bound `t`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, Suspense } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  createNamespace,
  defaultTextSource,
  setupI18n,
  someTexts,
  textCatalog,
} from "../../main/core/index.js";
import type { I18nRuntime, LoadingAware, LocaleSource, TextSource } from "../../main/core/index.js";
import { i18nContext } from "../../main/web-components/provider.js";
import { I18nProvider, useI18n, useSuspenseTexts } from "../../main/react/context.js";

// React 19's act() warns unless this is set, absent a testing-library environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const greetingTexts = createNamespace({
  key: "greeting",
  defaults: {
    hello: "Hello",
    welcome: (params: { name: string }) => `Welcome, ${params.name}!`,
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

let container: HTMLDivElement;
let root: Root;

function mount(node: Parameters<typeof h>[0], props?: unknown, ...children: unknown[]): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(h(node as never, props as never, ...(children as never[])));
  });
}

function dispatchContextRequest(
  target: Element,
  callback: (value: I18nRuntime, unsubscribe?: () => void) => void,
): void {
  target.dispatchEvent(
    Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
      context: i18nContext,
      callback,
    }),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe("useI18n", () => {
  it("without any provider, falls back to the module's zero-config default instance", () => {
    function Display() {
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(Display, null);
    expect(container.querySelector("#out")!.textContent).toBe("Hello");
  });

  it("scopes t to the given namespace, including dynamic (parameterized) keys", () => {
    const appRuntime = createFixedLocaleRuntime("de");
    function Display() {
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("welcome", { name: "Ada" }));
    }
    mount(I18nProvider, { runtime: appRuntime }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe("Welcome, Ada!");
  });

  it("without a namespace, returns a fully-qualified t and the raw i18n facade", () => {
    const appRuntime = createFixedLocaleRuntime("de-DE");
    function Display() {
      const { t, i18n } = useI18n();
      return h("span", { id: "out" }, `${t(greetingTexts, "hello")}:${i18n.formatNumber(1234.5)}`);
    }
    mount(I18nProvider, { runtime: appRuntime }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe(
      `Hello:${new Intl.NumberFormat("de-DE").format(1234.5)}`,
    );
  });

  it("re-renders with a fresh statically-bound snapshot on locale change", () => {
    const mutableSource = createMutableLocaleSource("de");
    const appRuntime = setupI18n({ localeSource: mutableSource });

    function Display() {
      const { t, i18n } = useI18n(greetingTexts);
      return h("span", { id: "out" }, `${i18n.locale()}:${t("hello")}`);
    }
    mount(I18nProvider, { runtime: appRuntime }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe("de:Hello");

    act(() => mutableSource.setLocale("fr"));
    expect(container.querySelector("#out")!.textContent).toBe("fr:Hello");
  });

  it("re-renders when late-arriving texts change (text-channel reactivity)", async () => {
    let resolveBundle!: (value: unknown) => void;
    const pendingBundle = new Promise((resolvePromise) => {
      resolveBundle = resolvePromise;
    });
    const appRuntime = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({ texts: [pendingBundle as never] }),
    });

    function Display() {
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(I18nProvider, { runtime: appRuntime }, h(Display, null));
    expect(container.querySelector("#out")!.textContent).toBe("Hello");

    await act(async () => {
      resolveBundle({ de: [someTexts(greetingTexts, { hello: "Hallo" })] });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });

  it("adopts a new i18n instance when the provider's prop changes", () => {
    const first = createFixedLocaleRuntime("de");
    const second = createFixedLocaleRuntime("fr");

    function Display() {
      const { i18n } = useI18n();
      return h("span", { id: "out" }, i18n.locale());
    }
    function App({ current }: { current: I18nRuntime }) {
      return h(I18nProvider, { runtime: current }, h(Display, null));
    }

    mount(App, { current: first });
    expect(container.querySelector("#out")!.textContent).toBe("de");

    act(() => root.render(h(App, { current: second })));
    expect(container.querySelector("#out")!.textContent).toBe("fr");
  });
});

describe("I18nProvider", () => {
  it("bridges the instance onto the DOM Context Community Protocol from its wrapper div", () => {
    const appRuntime = createFixedLocaleRuntime("de");
    function Child() {
      return h("span", { id: "marker" }, "child");
    }
    mount(I18nProvider, { runtime: appRuntime }, h(Child, null));

    const wrapperDiv = container.querySelector("div")!;
    expect(wrapperDiv.style.display).toBe("contents");

    const answers = vi.fn();
    dispatchContextRequest(container.querySelector("#marker")!, answers);
    expect(answers).toHaveBeenCalledWith(appRuntime, undefined);
  });

  it("re-provides (unsubscribing the old listener) when the i18n prop changes", () => {
    const first = createFixedLocaleRuntime("de");
    const second = createFixedLocaleRuntime("fr");

    function App({ current }: { current: I18nRuntime }) {
      return h(I18nProvider, { runtime: current }, h("span", { id: "marker" }, "child"));
    }
    mount(App, { current: first });

    const firstAnswers = vi.fn();
    dispatchContextRequest(container.querySelector("#marker")!, firstAnswers);
    expect(firstAnswers).toHaveBeenCalledWith(first, undefined);

    act(() => root.render(h(App, { current: second })));

    const secondAnswers = vi.fn();
    dispatchContextRequest(container.querySelector("#marker")!, secondAnswers);
    expect(secondAnswers).toHaveBeenCalledWith(second, undefined); // not `first` -> old listener is gone
  });

  it("stops providing once unmounted", () => {
    const appRuntime = createFixedLocaleRuntime("de");
    mount(I18nProvider, { runtime: appRuntime }, h("span", { id: "marker" }, "child"));
    const marker = container.querySelector("#marker")!;

    act(() => root.unmount());

    const answers = vi.fn();
    dispatchContextRequest(marker, answers); // detached from the document, but the listener itself must be gone
    expect(answers).not.toHaveBeenCalled();
  });
});

describe("useSuspenseTexts", () => {
  /** An async source that misses (-> defaults) while loading, then serves after `settle()`. */
  function createControllableAsyncSource(hit: string) {
    let loading = true;
    const listeners = new Set<() => void>();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolvePromise) => {
      resolveReady = resolvePromise;
    });
    const source: TextSource & LoadingAware = {
      resolve: (request) => (loading ? undefined : request.key === "hello" ? hit : undefined),
      ensure: () => (loading ? ready : undefined),
      onChange: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    const settle = (): void => {
      loading = false;
      resolveReady();
      for (const listener of [...listeners]) listener();
    };
    return { source, settle };
  }

  it("suspends while loading, then renders the real texts (never the default)", async () => {
    const { source, settle } = createControllableAsyncSource("Hallo");
    const appRuntime = setupI18n({ localeSource: "de", textSource: source });

    function Display() {
      useSuspenseTexts([greetingTexts]);
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "loading...") },
      h(I18nProvider, { runtime: appRuntime }, h(Display, null)),
    );

    // Suspended: fallback shown, the default "Hello" is never painted.
    expect(container.querySelector("#fallback")).not.toBeNull();
    expect(container.querySelector("#out")).toBeNull();

    await act(async () => {
      settle();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });

    expect(container.querySelector("#fallback")).toBeNull();
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });

  it("asks EVERY namespace before suspending, so the loads run in parallel", () => {
    const asked: string[] = [];
    const pending = new Promise<void>(() => undefined); // never settles
    const source: TextSource & LoadingAware = {
      resolve: () => undefined,
      ensure: (_locale, namespace) => {
        asked.push(namespace.key);
        return pending;
      },
    };
    const appRuntime = setupI18n({ localeSource: "de", textSource: source });
    const otherTexts = createNamespace({ key: "other", defaults: { hi: "Hi" } });

    function Display() {
      useSuspenseTexts([greetingTexts, otherTexts]);
      return h("span", null, "unreachable");
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "loading...") },
      h(I18nProvider, { runtime: appRuntime }, h(Display, null)),
    );

    expect(container.querySelector("#fallback")).not.toBeNull();
    // Both were asked in the SAME pass: the pending first namespace did not cut the
    // second one off. (React may repeat the pass, hence the slice.)
    expect(asked.slice(0, 2)).toEqual(["greeting", "other"]);
  });

  it("preloading the target locale switches without suspending", async () => {
    const mutableSource = createMutableLocaleSource("en");
    const runtime = setupI18n({
      localeSource: mutableSource,
      textSource: defaultTextSource({
        texts: [
          textCatalog({
            namespaces: [greetingTexts],
            locales: ["fr"],
            load: async () => {
              await tick();
              return { fr: [someTexts(greetingTexts, { hello: "Bonjour" })] };
            },
          }),
        ],
      }),
    });

    function Display() {
      useSuspenseTexts([greetingTexts]);
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "...") },
      h(I18nProvider, { runtime }, h(Display, null)),
    );
    expect(container.querySelector("#out")!.textContent).toBe("Hello");

    // Load the French texts BEFORE the locale changes: the gate then has nothing to wait
    // for, so the switch never reaches the fallback. (A `startTransition` around the
    // switch would not help - useSyncExternalStore updates are always urgent.)
    await act(async () => {
      await runtime.ensureTexts([greetingTexts], "fr");
    });
    act(() => mutableSource.setLocale("fr"));

    expect(container.querySelector("#fallback")).toBeNull();
    expect(container.querySelector("#out")!.textContent).toBe("Bonjour");
  });

  it("does not suspend when nothing is pending", () => {
    const readySource: TextSource & LoadingAware = {
      resolve: (request) => (request.key === "hello" ? "Hallo" : undefined),
      ensure: () => undefined,
    };
    const appRuntime = setupI18n({
      localeSource: "de",
      textSource: readySource,
    });

    function Display() {
      useSuspenseTexts([greetingTexts]);
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "loading...") },
      h(I18nProvider, { runtime: appRuntime }, h(Display, null)),
    );

    expect(container.querySelector("#fallback")).toBeNull();
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });

  it("is a no-op when the source cannot load on demand", () => {
    const plainSource: TextSource = {
      resolve: (request) => (request.key === "hello" ? "Hallo" : undefined),
    };
    const appRuntime = setupI18n({
      localeSource: "de",
      textSource: plainSource,
    });

    function Display() {
      useSuspenseTexts([greetingTexts]);
      const { t } = useI18n(greetingTexts);
      return h("span", { id: "out" }, t("hello"));
    }
    mount(
      Suspense,
      { fallback: h("span", { id: "fallback" }, "loading...") },
      h(I18nProvider, { runtime: appRuntime }, h(Display, null)),
    );

    expect(container.querySelector("#fallback")).toBeNull();
    expect(container.querySelector("#out")!.textContent).toBe("Hallo");
  });
});
