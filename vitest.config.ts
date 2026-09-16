import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const vitestConfig = defineConfig({
  test: {
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
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/{gamepad-haptics,gamepad-stick-processing}.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "chromium",
          include: ["src/**/*.test.ts"],
          exclude: ["src/{gamepad-haptics,gamepad-stick-processing}.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});

export default vitestConfig;
