import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "html"],
      include: ["src/lib/**", "src/cli/**"],
      exclude: [
        "src/__tests__/setup.ts",
        "src/cli/index.ts", // CLI entry point — side-effect-heavy, tested via E2E
        "src/cli/scanSequence.ts", // spinner I/O — not unit-testable
        "src/cli/analyzer.ts", // integration with Octokit APIs
        "src/lib/cache.ts", // Redis integration
        "src/lib/github.ts", // Octokit integration
        "src/lib/vulnerabilities.ts", // OSV.dev integration
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
