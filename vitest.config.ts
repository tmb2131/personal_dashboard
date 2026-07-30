import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Mirrors the `@/*` path alias from tsconfig.json.
 *
 * Without it Vitest cannot resolve `@/…` imports, which forced tests to
 * `vi.mock` unrelated modules purely to stop resolution failing. Existing
 * mocks still take precedence — this only makes unmocked imports work.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
