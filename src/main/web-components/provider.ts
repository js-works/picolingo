import type { I18nRuntime, Unsubscribe } from "../core/index.js";

export { i18nContext, provideI18n, ContextRequestEvent, I18nProviderElement };

// -------------------------------------------------------------------
// # Context Community Protocol
// -------------------------------------------------------------------

// The protocol's event shape: fields live directly on the event (not in `detail`).
class ContextRequestEvent extends Event {
  public readonly context: unknown;
  public readonly callback: ContextCallback;
  public readonly subscribe?: boolean;

  constructor(context: unknown, callback: ContextCallback, subscribe?: boolean) {
    super("context-request", { bubbles: true, composed: true });
    this.context = context;
    this.callback = callback;
    this.subscribe = subscribe;
  }
}

/** Is this a request for OUR context, with a usable callback? */
function isI18nRequest(event: Event): event is Event & ContextRequestEvent {
  const request = event as Partial<ContextRequestEvent>;
  return request.context === i18nContext && typeof request.callback === "function";
}

// -------------------------------------------------------------------
// # Providers
// -------------------------------------------------------------------

// The context key. `Symbol.for` (global symbol registry) so that multiple copies or
// versions of this module in one bundle still interoperate - key equality is the
// protocol's only identity mechanism. The trailing `@1` versions the VALUE contract
// (the shape of `I18nRuntime`), not the package: two copies find each other only while
// they agree on it, and a mismatch degrades to "no provider found" instead of to a
// TypeError at the first call.
const i18nContext: symbol = Symbol.for("picolingo.I18nRuntime@1");

type ContextCallback = (value: I18nRuntime, unsubscribe?: Unsubscribe) => void;

/**
 * Make `target` answer i18n context requests with the given runtime. Mount it on any
 * ancestor of the consuming components - `document.body` for app-wide provision.
 * Returns an Unsubscribe that stops providing.
 */
function provideI18n(target: EventTarget, runtime: I18nRuntime): Unsubscribe {
  const listener = (event: Event): void => {
    if (!isI18nRequest(event)) {
      return; // some other context's request - let it bubble on
    }
    event.stopPropagation();
    // Our provided value never changes (the runtime is stable; locale and text changes
    // are delivered via runtime.onChange), so subscribers get a no-op unsubscribe.
    event.callback(runtime, event.subscribe ? () => undefined : undefined);
  };

  target.addEventListener("context-request", listener);
  return () => target.removeEventListener("context-request", listener);
}

// HTMLElement is absent outside the browser; a dummy base keeps this module loadable
// there (the element is only registered client-side anyway).
const ElementBase: typeof HTMLElement =
  globalThis.HTMLElement ?? (class {} as unknown as typeof HTMLElement);

/**
 * Declarative provider for templates:
 *
 *   <i18n-provider .runtime=${appRuntime}>
 *     <fancy-date-picker></fancy-date-picker>
 *   </i18n-provider>
 *
 * Layout-neutral (`display: contents`). Value semantics:
 *   - Requests arriving while `runtime` is set are answered and claimed (stopPropagation).
 *   - Requests arriving BEFORE `runtime` is set are NOT claimed (an outer provider may
 *     serve meanwhile); `subscribe` requests are remembered and answered as soon as a
 *     value arrives - consumers keep the latest answer.
 *   - Setting a NEW runtime re-notifies all subscribed consumers.
 */
class I18nProviderElement extends ElementBase {
  #runtime: I18nRuntime | null = null;
  // subscriber -> its STABLE unsubscribe (stable so consumers can compare identity
  // across repeated answers, as e.g. @lit/context consumers do)
  #subscribers = new Map<ContextCallback, Unsubscribe>();

  readonly #listener = (event: Event): void => {
    if (!isI18nRequest(event)) {
      return;
    }
    const { callback, subscribe } = event;

    if (subscribe) {
      let unsubscribe = this.#subscribers.get(callback);
      if (!unsubscribe) {
        unsubscribe = () => void this.#subscribers.delete(callback);
        this.#subscribers.set(callback, unsubscribe);
      }
      if (this.#runtime) {
        event.stopPropagation();
        callback(this.#runtime, unsubscribe);
      }
      // no value yet: keep the subscription, but let the request bubble on so an
      // outer provider can serve in the meantime.
    } else if (this.#runtime) {
      event.stopPropagation();
      callback(this.#runtime);
    }
  };

  get runtime(): I18nRuntime | null {
    return this.#runtime;
  }

  set runtime(value: I18nRuntime | null) {
    if (value === this.#runtime) return;
    this.#runtime = value;
    if (value) {
      for (const [callback, unsubscribe] of [...this.#subscribers] /* NOSONAR */) {
        callback(value, unsubscribe);
      }
    }
  }

  connectedCallback(): void {
    this.style.display = "contents"; // provider must not affect layout
    this.addEventListener("context-request", this.#listener);
  }

  disconnectedCallback(): void {
    this.removeEventListener("context-request", this.#listener);
  }
}

// Register on import - guarded against double registration (duplicate bundle copies)
// and against non-browser environments.
if (globalThis.customElements && !globalThis.customElements.get("i18n-provider")) {
  globalThis.customElements.define("i18n-provider", I18nProviderElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "i18n-provider": I18nProviderElement;
  }
}
