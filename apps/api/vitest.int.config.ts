import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.int.test.ts"],
    root: ".",
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://opsdesk:opsdesk@localhost:5432/opsdesk_test?schema=public",
      JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123456",
      BCRYPT_ROUNDS: "4",
      WEB_ORIGIN: "http://localhost:3000",
    },
  },
});
