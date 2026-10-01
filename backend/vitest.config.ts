import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Existing suites exercise routes without tokens; auth tests pass an explicit verifier.
    env: { BACKEND_AUTH_REQUIRED: "false" },
  },
});
