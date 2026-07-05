import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          root: "shared",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "space",
          root: "space",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "explorer",
          root: "explorer",
          include: ["tests/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["shared/src/**", "space/src/**", "explorer/src/**"],
      exclude: ["explorer/src/components/ui/**", "explorer/src/main.tsx", "space/src/server.ts"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
});
