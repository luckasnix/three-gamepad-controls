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
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        branches: 0,
        functions: 0,
        lines: 0,
        statements: 0,
      },
    },
  },
});

export default vitestConfig;
