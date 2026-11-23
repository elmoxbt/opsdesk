import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC is needed so Nest's decorators emit the metadata its DI container reads.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: { include: ["src/**/*.test.ts"], root: "." },
});
