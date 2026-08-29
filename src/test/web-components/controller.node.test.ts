/**
 * Node-environment import test: the module must load without a DOM (dummy element
 * base, registration skipped) so isomorphic bundles do not crash on the server.
 */
import { describe, expect, it } from "vitest";
import { connectI18n } from "../../main/web-components/controller.js";
import {
  I18nProviderElement,
  i18nContext,
  provideI18n,
} from "../../main/web-components/provider.js";

describe("controller (server-side import)", () => {
  it("loads without a DOM and exports its surface", () => {
    expect(typeof connectI18n).toBe("function");
    expect(typeof provideI18n).toBe("function");
    expect(typeof I18nProviderElement).toBe("function");
    expect(typeof i18nContext).toBe("symbol");
    expect(i18nContext).toBe(Symbol.for("picolingo.I18nRuntime@1")); // interop contract
  });
});
