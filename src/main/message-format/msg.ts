import IntlMessageFormat from "intl-messageformat";
import type { TranslationFn } from "../core/index.js";

export { msg };

const cache = new Map<string, IntlMessageFormat>();

function msg<P extends Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...expr: never[] // ICU syntax lives IN the string, not in ${}-interpolations
): TranslationFn<P> {
  // The type signature already blocks this for TypeScript callers; this is the runtime
  // twin (mirroring `checkTexts`) for plain-JS callers, who would otherwise see their
  // interpolated value silently dropped - `strings.raw.join("")` ignores it entirely.
  if (expr.length > 0) {
    throw new TypeError(
      "msg: interpolated values (${...}) are not supported - write the ICU placeholder " +
        "directly in the string, e.g. msg`Hello {name}` instead of msg`Hello ${name}`.",
    );
  }
  const pattern = strings.raw.join(""); // a single static string
  return (params, i18n) => {
    const locale = i18n.locale();
    const key = `${locale}\u0001${pattern}`;
    let fmt = cache.get(key);

    if (!fmt) {
      fmt = new IntlMessageFormat(pattern, locale);
      cache.set(key, fmt);
    }

    return String(fmt.format(params));
  };
}
