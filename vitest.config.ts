import { defineConfig } from "vitest/config";

const vitestConfig = defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/*.test.ts"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});

export default vitestConfig;
