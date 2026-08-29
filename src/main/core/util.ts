/**
 * The handful of primitives the other core modules share: freezing, null-prototype
 * records, the change-listener registry, and the locale-tag guard that fails at setup
 * instead of at the first miss.
 */

import type { ChangeListener, Locale, Unsubscribe } from "./contracts.js";

export { checkLocaleTags, createListeners, createRecord, freeze };

function freeze<T extends object>(obj: T): Readonly<T> {
  return Object.freeze(obj);
}

/** Create a null-prototype record so keys like "toString" behave as missing. */
function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** A change-listener registry: `add` returns an idempotent unsubscribe. */
function createListeners(): Readonly<{
  add(listener: ChangeListener): Unsubscribe;
  notify(): void;
}> {
  const listeners = new Set<ChangeListener>();
  return freeze({
    add: (listener: ChangeListener): Unsubscribe => {
      listeners.add(listener);
      return () => void listeners.delete(listener); // NOSONAR // idempotent
    },
    // Iterate a copy: listeners may (un)subscribe during notification.
    notify: (): void => {
      for (const listener of [...listeners] /* NOSONAR */) listener();
    },
  });
}

/** Reject invalid locale tags at setup, where the mistake is, not at the first miss. */
function checkLocaleTags(tags: readonly Locale[]): void {
  for (const tag of tags) new Intl.Locale(tag); // throws on an invalid tag
}
