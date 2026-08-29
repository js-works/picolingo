/**
 * React bindings for the i18n facade.
 *
 * Three public entry points - `I18nProvider`, `useI18n` and the `useSuspenseTexts` gate
 * - mirroring the minimal surface of the other bindings. The React context is private;
 * consumers interact only through these.
 *
 * What travels is the RUNTIME, not a facade: it is what the gate needs (`ensureTexts`)
 * and what the change channel lives on, and facades are derived from it wherever they
 * are used. The provider serves it on TWO channels:
 *   - React context, for `useI18n` in React components;
 *   - the DOM/context protocol (via `provideI18n` on a layout-neutral wrapper), for
 *     custom elements rendered in the subtree - the primary path when React merely
 *     hosts Picolingo-based web components.
 *
 * `useI18n` returns a facade plus a bound `t` (scoped to the given namespace, or
 * fully-qualified without one). It re-renders on locale AND text changes by minting a
 * FRESH statically-bound facade per change: facades are stateless views, so a new one
 * per event costs an object and guarantees the identity change `useSyncExternalStore`
 * needs - a text-only change (locale unchanged) must not look like "nothing changed".
 * Binding it statically also keeps the locale consistent across one render pass
 * (tearing-safe under concurrent rendering).
 *
 * JSX-free on purpose (uses `createElement as h`), so this file is a plain `.ts`.
 */

import {
  createContext,
  createElement as h,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import type { ReactNode } from "react";
import { createI18n, setupI18n } from "../core/index.js";
import { provideI18n } from "../web-components/index.js";
import type {
  BoundTexts,
  I18n,
  I18nRuntime,
  Namespace,
  TextMap,
  UnboundTexts,
} from "../core/index.js";

export { I18nProvider, useI18n, useSuspenseTexts };

// -------------------------------------------------------------------
// # Context (private)
// -------------------------------------------------------------------

// Default: a zero-config runtime, so `useI18n` works without a provider - untranslated
// but never broken, mirroring the controller's and provider's fallback behavior.
const I18nContext = createContext<I18nRuntime>(setupI18n());

// -------------------------------------------------------------------
// # Provider
// -------------------------------------------------------------------

/**
 * Provide an i18n runtime to the subtree - to React components (via context) AND to
 * custom elements (via the DOM context protocol, on a `display: contents` wrapper that
 * is present in the DOM for event bubbling but invisible to layout).
 *
 * Pass a STABLE runtime (module scope, or memoized) - one created inline on every
 * render would reset the snapshot machinery and thrash re-rendering. For a per-request
 * locale on a server, wire the locale into the runtime itself:
 * `setupI18n({ localeSource: defaultLocaleSource({ serverSide: request.locale }), textSource })`.
 */
function I18nProvider({ runtime, children }: { runtime: I18nRuntime; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  // Bridge to the DOM/context protocol for custom elements in the subtree. `ref.current`
  // is guaranteed attached here (React commits refs before running passive effects, and
  // the wrapper div below is rendered unconditionally) - the null check is a defensive
  // fallback with no reachable path under normal rendering; see provider-ref.test.ts
  // for the one way (mocking `useRef`) it can be exercised at all.
  useEffect(() => {
    /* v8 ignore next */
    return ref.current ? provideI18n(ref.current, runtime) : undefined;
  }, [runtime]);

  return h(
    I18nContext.Provider,
    { value: runtime },
    h("div", { ref, style: { display: "contents" } }, children),
  );
}

// -------------------------------------------------------------------
// # Hook
// -------------------------------------------------------------------

/**
 * Access an i18n facade and a bound `t`.
 *
 *   const { t, i18n } = useI18n(dialogTexts); // t is scoped to dialogTexts
 *   const { t, i18n } = useI18n();            // t is the fully-qualified lookup
 *
 * Re-renders the component on locale and text changes.
 */
function useI18n(): { i18n: I18n; t: UnboundTexts };
function useI18n<T extends TextMap>(namespace: Namespace<T>): { i18n: I18n; t: BoundTexts<T> };
function useI18n(namespace?: Namespace<any>): { i18n: I18n; t: (...args: any[]) => string } {
  const runtime = useContext(I18nContext);

  // A store whose snapshot IDENTITY changes on every locale/text change, so
  // useSyncExternalStore actually re-renders.
  const store = useMemo(() => {
    const freshSnapshot = (): I18n => createI18n(runtime, runtime.currentLocale());
    let snapshot: I18n = freshSnapshot();
    return {
      subscribe: (onStoreChange: () => void) =>
        runtime.onChange(() => {
          snapshot = freshSnapshot(); // fresh identity per event, always
          onStoreChange();
        }),
      getSnapshot: () => snapshot,
    };
  }, [runtime]);

  // Third arg = server snapshot (SSR): the per-request runtime arrives via the provider.
  const i18n = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Derived from the current snapshot, so `t` changes identity per render - safe in
  // dependency arrays.
  const t = useMemo(
    () => (namespace ? i18n.bindTexts(namespace) : i18n.bindTexts()),
    [i18n, namespace],
  );

  return { i18n, t };
}

/**
 * The GATE: suspend until the given namespaces have their texts for the active locale.
 * Returns nothing - it is a precondition, not an accessor; read the texts with `useI18n`
 * afterwards. Must be inside a `<Suspense>` boundary.
 *
 *   function LoginDialog() {
 *     useSuspenseTexts([dialogTexts, commonTexts, errorTexts]);
 *     const { t } = useI18n(dialogTexts);
 *     return <h1>{t("title")}</h1>;               // and t(commonTexts, "cancel") ...
 *   }
 *
 * ALL namespaces in ONE call, because every load starts before the promise is thrown:
 * one hook per namespace would suspend on the first and never reach the others, turning
 * what should be one round trip into a waterfall.
 *
 * Gate and access are separate hooks so the gate can be HOISTED: a route can await the
 * namespaces of its whole subtree, after which the components' own gates are no-ops and
 * nothing loads in sequence. That is impossible if a hook has to return `t`.
 *
 * The gate needs nothing but the runtime from context, so a component from a
 * third-party library can gate without being handed the app's configuration. When the
 * app's source cannot load on demand this hook does NOTHING - same graceful degradation
 * as everywhere else: defaults render, real texts swap in when `onChange` fires.
 */
function useSuspenseTexts(namespaces: readonly Namespace<any>[]): void {
  const runtime = useContext(I18nContext);
  // Subscribes, so a HOISTED gate re-runs (and re-suspends) when the locale changes -
  // and reads the locale from the same snapshot the subtree will render with.
  const { i18n } = useI18n();
  const pending = runtime.ensureTexts(namespaces, i18n.locale());

  // Suspense catches this and retries the render once everything has settled.
  if (pending) throw pending;
}
