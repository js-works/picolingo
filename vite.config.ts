import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// ESM-only library build. Entry points:
//   .                -> src/main/core/index.ts            (vanilla, dependency-free)
//   ./message-format -> src/main/message-format/index.ts  (ICU MessageFormat helper)
//   ./web-components -> src/main/web-components/index.ts  (vanilla, dependency-free)
//   ./react          -> src/main/react/index.ts           (needs React as an optional peer)
//   ./dev            -> src/main/dev/index.ts             (coverage + miss reporting, never
//                                                          imported by production code)
//
// The core is NOT externalized: every adapter imports it through `src/main/core/index.ts`,
// so Rollup emits it ONCE - as `chunks/core-*.js`, shared by every entry that needs it.
// One core instance, no duplication; the extra file costs a request, not bytes. React IS
// externalized so it is never bundled into the ./react entry (the host app owns its
// single React copy).
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true, // emit a .d.ts entry per lib entry
      include: ["src/main"],
    }),
  ],
  build: {
    target: "es2022", // Object.hasOwn + #private fields must survive untranspiled
    minify: false, // libraries ship readable code; consumers minify
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, "src/main/core/index.ts"),
        "message-format/index": resolve(__dirname, "src/main/message-format/index.ts"),
        "web-components/index": resolve(__dirname, "src/main/web-components/index.ts"),
        "react/index": resolve(__dirname, "src/main/react/index.ts"),
        "dev/index": resolve(__dirname, "src/main/dev/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // React (and react-dom / jsx-runtime) stay external - an optional peer, owned by
      // the host app. node: builtins never get bundled either.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^node:/],
      output: {
        entryFileNames: "[name].js", // -> index.js, react/index.js, dev/index.js, ...
        // shared code (the core) lands in chunks/ - the single shared core instance
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
