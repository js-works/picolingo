import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/main/**/*.ts"],
      exclude: ["**/index.ts", "**/*.d.ts"],
      reporter: ["text"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
