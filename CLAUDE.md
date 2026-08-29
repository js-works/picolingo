# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Never commit or push

Do not run `git commit` or `git push` - the maintainers land every change themselves. Leave finished work in the working tree and report what changed. Other git commands (`status`, `diff`, `log`, `stash`) are fine. Both commands are additionally blocked via `permissions.deny` in `.claude/settings.json`.

## What this is

`Picolingo` is a small, type-safe i18n facade for vanilla JS, web components, and React. Zero-config components ship default texts; translations are attached separately; apps wire it all together. See `README.md` for the full public API tour and [ARCHITECTURE.md](ARCHITECTURE.md) for the internal design rationale.

## Commands

- `npm run build` - production build via Vite (three entry points, see Architecture below)
- `npm test` - run the full test suite once (Vitest)
- `npm run test:watch` - Vitest in watch mode
- `npm run coverage` - run tests with v8 coverage (thresholds: 95% statements/functions/lines, 90% branches - enforced in `vitest.config.ts`)
- `npm run size` - build, then report what an app actually ships, per scenario (minified + brotli; React ignored, it is a peer). Each row in `.size-limit.json` is a COMPLETE setup, not a component - rows are alternatives and must never be added up, since every binding already contains the part of the core it uses. The multi-package rows point at the `export *` fixtures in `scripts/size/`, because size-limit does not union several paths in one entry. Reporting only: no entry declares a `limit`, so it never fails; add `"limit": "4 kB"` to turn one into a CI budget. Note that the sizes Vite prints during the build are gzip of UNMINIFIED code - roughly three times the real cost, since the build ships readable code on purpose and consumers minify.
- Single test file: `npx vitest run src/test/core.test.ts`
- Single test by name: `npx vitest run -t "test name substring"`
- `npm run build:release` - build, then zip the exact git-tracked source tree into `dist/source/` (via `scripts/pack-source.mts`)
- `npm run loc` - line counts over `src/main` (`sloc`); `npm run loc:json` for the same as JSON

No lint script is configured; formatting is Prettier (`.prettierrc`: `printWidth: 100`) and `.editorconfig` (2-space indent, LF, trim trailing whitespace).

## Architecture

**[ARCHITECTURE.md](ARCHITECTURE.md) is the single source of truth** for the design: the
runtime/facade split, the three strategies, the resolution order, the module map of
`src/main/core/`, the other entry points, and the three ecosystem roles. Read it before
changing anything structural, and update it in the same commit when a decision there
stops being true - do not restate it here or in a docblock.

Two things worth having in mind while working:

- Layout is Maven-style: shipped code in `src/main`, tests in `src/test` mirroring it.
  `tsconfig.json` and Vite see only `src/main`, Vitest only `src/test`.
- Bindings are handed the `I18nRuntime`, never an `I18n`. If something inside a binding
  seems to need more than the runtime exposes, that is a design question, not a reason
  to reach past `core/index.ts`.

### Test environments

Vitest defaults to the `node` environment; individual files opt into `jsdom` via a `// @vitest-environment jsdom` docblock comment (not global config), because some behavior must be verified in both:

- `*.dom.test.ts` / files with the jsdom pragma - DOM-dependent behavior (e.g. `<html lang>` `MutationObserver` monitoring, custom element integration).
- `*.node.test.ts` - explicitly verifies isomorphic/SSR-safe behavior (modules must load without a DOM and skip registration gracefully).

When adding tests for DOM-touching code, add both a jsdom-environment test for behavior and consider whether a node-environment import test is needed to guard the isomorphic path.

## ASCII only

Every file - code, comments, docs, tests - uses ASCII characters exclusively. No typographic punctuation: write `-` instead of an em or en dash, `->` instead of an arrow, `...` instead of an ellipsis, `"` and `'` instead of curly quotes, `(c)` instead of a copyright sign.

The one exception is text that genuinely belongs to a non-ASCII language: translation examples and test fixtures such as `"Gruezi"`-style German, French, or Chinese strings keep their real spelling, because mangling them would make them wrong.

## TypeScript coding conventions

- Do not use `var`. Use `const` and `let` instead.
- Use arrow function expressions for closures, where possible.
- All modern ECMAScript features are allowed to use.
