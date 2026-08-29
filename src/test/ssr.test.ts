import { describe, expect, it } from "vitest";
import {
  createI18n,
  createNamespace,
  defaultTextSource,
  setupI18n,
  someTexts,
  textCatalog,
} from "../main/core/index.js";
import type { Namespace, TextMiddleware } from "../main/core/index.js";

// The recipe the README documents under "Server-side rendering", built from nothing but
// public API: a middleware records which namespaces a render touched, the client
// preloads exactly those before hydrating. Kept as a test because the README promises it.
function recordUsedNamespaces() {
  const used = new Set<string>();
  const middleware: TextMiddleware = (request, _context, next) => {
    used.add(request.namespace.key);
    return next();
  };
  return { middleware, keys: (): string[] => [...used] };
}

const cart = createNamespace({ key: "cart", defaults: { title: "Cart" } });
const legal = createNamespace({ key: "legal", defaults: { imprint: "Imprint" } });
const inventory: Namespace<any>[] = [cart, legal];

const catalogs = () => [
  textCatalog({
    namespaces: [cart, legal],
    locales: ["de"],
    load: async () => ({
      de: [someTexts(cart, { title: "Warenkorb" }), someTexts(legal, { imprint: "Impressum" })],
    }),
  }),
];

describe("SSR: record on the server, preload on the client", () => {
  it("preloading the recorded namespaces makes the client match the server", async () => {
    // ---------- server ----------
    const used = recordUsedNamespaces();
    const server = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({ texts: catalogs() }),
      middlewares: [used.middleware],
    });
    await server.ensureTexts([cart], "de"); // as a route gate would
    const serverHtml = createI18n(server).text(cart, "title");
    const forClient = used.keys(); // embedded into the HTML

    expect(serverHtml).toBe("Warenkorb");
    expect(forClient).toEqual(["cart"]); // "legal" was never rendered

    // ---------- client ----------
    const client = setupI18n({
      localeSource: "de",
      textSource: defaultTextSource({ texts: catalogs() }),
    });
    const naive = createI18n(client).text(cart, "title"); // without preloading: the mismatch
    await client.ensureTexts(
      inventory.filter((ns) => forClient.includes(ns.key)),
      "de",
    );
    const hydrated = createI18n(client).text(cart, "title");

    expect(naive).toBe("Cart"); // exactly the flicker
    expect(hydrated).toBe(serverHtml); // after preloading, identical
  });
});
