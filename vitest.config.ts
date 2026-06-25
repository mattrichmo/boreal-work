import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@boreal/agent-runtime": fromRoot("./packages/agent-runtime/src/index.ts"),
      "@boreal/core": fromRoot("./packages/core/src/index.ts"),
      "@boreal/engine": fromRoot("./packages/engine/src/index.ts"),
      "@boreal/evidence-engine": fromRoot("./packages/evidence-engine/src/index.ts"),
      "@boreal/graph-engine": fromRoot("./packages/graph-engine/src/index.ts"),
      "@boreal/knowledge-engine": fromRoot("./packages/knowledge-engine/src/index.ts"),
      "@boreal/search": fromRoot("./packages/search/src/index.ts"),
      "@boreal/storage": fromRoot("./packages/storage/src/index.ts"),
      "@boreal/ui-model": fromRoot("./packages/ui-model/src/index.ts"),
      "@boreal/work-engine": fromRoot("./packages/work-engine/src/index.ts")
    }
  }
});
