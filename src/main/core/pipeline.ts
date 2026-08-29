/**
 * The resolution pipeline: middlewares wrapped around the text source, with the
 * namespace defaults as the terminal INSIDE the chain - so a middleware sees
 * default-resolved texts too, and `next() === undefined` means a hard miss.
 */

import { freeze } from "./util.js";
import type {
  ResolveContext,
  TextMiddleware,
  TextRequest,
  TextResolver,
  TextMap,
  TextSource,
} from "./contracts.js";

export { composePipeline, resolveFromDefaults };

// What a namespace's defaults hold per key. DERIVED from the public shape, never
// restated - a second spelling could drift from it silently.
type TextValue = TextMap[string];

/**
 * Terminal resolver of last resort: the namespace's own default texts. Dynamic
 * defaults get an I18n bound to the REQUESTED locale (data formatting in the user's
 * conventions inside default-language text); a default author who needs a fixed
 * locale can use `i18n.withLocale("en")` inside the function body.
 */
function resolveFromDefaults(request: TextRequest, context: ResolveContext): string | undefined {
  const value = (request.namespace.defaults as Record<string, TextValue | undefined>)[request.key];
  if (typeof value === "string") return value;
  if (typeof value === "function" && request.params != null) {
    return value(request.params, context.localize(request.locale));
  }
  return undefined;
}

/**
 * Compose the middleware chain around the text source and the defaults terminal.
 * Index 0 is outermost; `next(patch)` merges the patch over the current request (last
 * write wins). Because the defaults terminal sits INSIDE the pipeline, middlewares
 * (e.g. pseudo-localization) see default-resolved texts too - `next() === undefined`
 * therefore signals a HARD miss (no source hit AND no default).
 */
function composePipeline(
  textSource: TextSource | undefined,
  middlewares: readonly TextMiddleware[],
  context: ResolveContext,
): (request: TextRequest) => string | undefined {
  const terminal: TextResolver = (request, ctx) => {
    const fromSource = textSource?.resolve(request, ctx);
    return fromSource !== undefined ? fromSource : resolveFromDefaults(request, ctx);
  };

  return (request) => {
    const dispatch = (index: number, req: TextRequest): string | undefined =>
      index < middlewares.length
        ? middlewares[index](req, context, (patch) =>
            dispatch(index + 1, patch ? freeze({ ...req, ...patch }) : req),
          )
        : terminal(req, context);
    return dispatch(0, request);
  };
}
