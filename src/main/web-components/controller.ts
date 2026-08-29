/**
 * Custom-element bindings for the i18n facade - the Context Community Protocol
 * (https://github.com/webcomponents-cg/community-protocols) as distribution
 * mechanism, dependency-free (works with, but does not require, Lit).
 *
 *   - `connectI18n(host)` - connects the host to the i18n runtime of its tree and
 *     hands back something that IS an I18n (delegating), re-rendering on change.
 *   - `<i18n-provider .runtime=${...}>` - declarative provision inside templates.
 *   - `provideI18n(target, runtime)` - imperative provision on any EventTarget
 *     (e.g. `document.body` for app-wide provision).
 *
 * The runtime is resolved in two stages, first match wins:
 *
 *   context-request (protocol) -> internal zero-config fallback
 *
 * Interop: consumers and providers only share the `context-request` event and the
 * `i18nContext` key (a `Symbol.for` registry symbol), so this module interoperates
 * with any protocol-compliant counterpart (e.g. an @lit/context provider using the
 * same key) - across bundle copies and versions.
 *
 * Importing this module registers the `<i18n-provider>` element (guarded against
 * double registration and non-browser environments).
 */

import { createI18n, setupI18n } from "../core/index.js";
import type { I18n, I18nRuntime, Namespace, Unsubscribe } from "../core/index.js";
import { i18nContext, ContextRequestEvent } from "./provider.js";

export { connectI18n };
export type { I18nController, I18nControllerHost, I18nControllerOptions };

// -------------------------------------------------------------------
// # Internal zero-config fallback (NOT exported, immutable once created)
// -------------------------------------------------------------------

let fallbackRuntime: I18nRuntime | undefined;

function getFallbackRuntime(): I18nRuntime {
  return (fallbackRuntime ??= setupI18n());
}

// -------------------------------------------------------------------
// # Reactive controller
// -------------------------------------------------------------------

type I18nController = I18n & {
  // Lit's ReactiveController interface - called for you when the host has
  // `addController`; `connect`/`disconnect` are the same thing for hosts that do not.
  hostConnected(): void;
  hostDisconnected(): void;
  connect(): void;
  disconnect(): void;
  // True while the declared `texts` are still being fetched for the active locale.
  // Always false when no `texts` were declared or the app's source cannot load on demand.
  readonly loading: boolean;
};

type I18nControllerOptions = Readonly<{
  // The namespaces this component needs. Declaring them lets the app's source start
  // loading at CONNECT time rather than at the first text read, and drives `loading`.
  texts?: readonly Namespace<any>[];
  // How to re-render a host that has no `requestUpdate` of its own (a plain custom
  // element). Ignored when the host provides one.
  requestUpdate?: () => void;
}>;

// Must be an EventTarget (e.g. a LitElement or a plain custom element) so the
// controller can dispatch `context-request` events per the Context Community Protocol.
// A Lit-style host additionally offers `requestUpdate` and `addController`; a plain one
// passes `options.requestUpdate` and calls `connect`/`disconnect` itself.
type I18nControllerHost = EventTarget & {
  requestUpdate?(): void;
  addController?(controller: I18nController): void;
};

/**
 * Connect `host` to the i18n runtime of its tree. The result IS an I18n (derived from
 * whichever runtime is current) and re-renders the host on locale/text changes.
 *
 * Runtime resolution, first match wins:
 *   1. a context provider up the tree (re-requested on every connect; providers may
 *      answer late via `subscribe`)
 *   2. the internal zero-config fallback
 *
 * With a Lit-style host, everything is automatic:
 *
 *   #i18n = connectI18n(this, { texts: [datePickerTexts] });
 *   #t = this.#i18n.bindTexts(datePickerTexts);   // safe as a field: binds lazily
 *   render() { return html`<button>${this.#t("today")}</button>`; }
 *
 * A plain custom element supplies the two things Lit would have provided:
 *
 *   #i18n = connectI18n(this, { texts: [ns], requestUpdate: () => this.#render() });
 *   connectedCallback() { this.#i18n.connect(); }
 *   disconnectedCallback() { this.#i18n.disconnect(); }
 *
 * `options.texts` declares which namespaces the component needs. There is no Suspense
 * in the DOM: nothing can pause a render and repeat it later, so instead of throwing a
 * promise the controller exposes `loading` and the component renders its own placeholder
 * - or, usually better, renders the defaults and lets the real texts swap in. A spinner
 * in place of a perfectly readable default label is rarely an improvement. Reach for
 * `loading` where the WRONG language is worse than a delay - legal notices,
 * confirmations with consequences - not for button captions.
 *
 * Everything the controller hands out keeps working across a provider switch: a `t` from
 * `bindTexts` and a sibling from `withLocale` resolve through whichever runtime is
 * current, so they can safely be stored in fields.
 */
function connectI18n(
  host: I18nControllerHost,
  options: I18nControllerOptions = {},
): I18nController {
  const namespaces = options.texts ?? [];
  const requestUpdate = (): void =>
    void (host.requestUpdate ? host.requestUpdate() : options.requestUpdate?.());

  // The runtime the controller currently speaks to; a context provider may swap it.
  let runtime: I18nRuntime = getFallbackRuntime();

  // Everything else goes through THIS runtime, which forwards to whichever one is
  // current. So one derived facade covers the whole I18n surface and survives a switch -
  // including a `t` from `bindTexts` and a sibling from `withLocale`, which resolve
  // through it instead of pinning the runtime that was current when they were made.
  const hostRuntime: I18nRuntime = Object.freeze({
    currentLocale: () => runtime.currentLocale(),
    onChange: (listener) => runtime.onChange(listener),
    resolveText: (namespace, key, params, locale) =>
      runtime.resolveText(namespace, key, params, locale),
    hasText: (namespace, key, locale, includeFallback) =>
      runtime.hasText(namespace, key, locale, includeFallback),
    ensureTexts: (declared, locale) => runtime.ensureTexts(declared, locale),
  });

  let connected = false;
  let loading = false;
  let generation = 0; // invalidates the in-flight wait when locale or runtime changes
  let unsubscribeChange: Unsubscribe | null = null;
  let unsubscribeContext: Unsubscribe | null = null;

  function setLoading(value: boolean): void {
    if (loading === value) return;
    loading = value;
    if (connected) requestUpdate();
  }

  /** Start the loads the declared namespaces need, and track whether any is pending. */
  function ensureTexts(): void {
    const token = ++generation;
    const pending = namespaces.length
      ? hostRuntime.ensureTexts(namespaces, hostRuntime.currentLocale())
      : undefined;
    if (!pending) return setLoading(false); // nothing declared, loaded, or no capability

    setLoading(true);
    void pending.then(() => {
      if (token === generation) setLoading(false); // ignore a superseded wait
    });
  }

  function subscribeToCurrent(): void {
    unsubscribeChange?.();
    unsubscribeChange = hostRuntime.onChange(() => {
      ensureTexts(); // the locale may have changed: the new one may need loading
      requestUpdate();
    });
  }

  function switchTo(next: I18nRuntime): void {
    if (next === runtime) return;
    runtime = next;
    if (connected) {
      subscribeToCurrent();
      ensureTexts();
      requestUpdate();
    }
  }

  function connect(): void {
    connected = true;
    subscribeToCurrent();
    ensureTexts(); // start loading before the first render, not at the first read

    host.dispatchEvent(
      new ContextRequestEvent(
        i18nContext,
        (value, unsubscribe) => {
          // A provider may answer repeatedly (late value, changed value). Keep
          // only the latest subscription - but compare identity first: repeated
          // answers of the SAME subscription must not unsubscribe themselves.
          if (unsubscribe !== unsubscribeContext) {
            unsubscribeContext?.();
            unsubscribeContext = unsubscribe ?? null;
          }
          switchTo(value);
        },
        true, // subscribe: allow late/updated answers
      ),
    );
  }

  function disconnect(): void {
    connected = false;
    unsubscribeChange?.();
    unsubscribeChange = null;
    unsubscribeContext?.();
    unsubscribeContext = null;
  }

  const controller: I18nController = {
    ...createI18n(hostRuntime),

    get loading() {
      return loading;
    },

    connect,
    disconnect,
    hostConnected: connect,
    hostDisconnected: disconnect,
  };

  host.addController?.(controller);
  return Object.freeze(controller);
}
