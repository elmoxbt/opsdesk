// @ts-check
import root from "../../eslint.config.mjs";

export default [
  ...root,
  {
    // Nest DI reads constructor param types from emitted decorator metadata. Rewriting
    // `import { X }` to `import type { X }` erases that metadata and breaks injection at runtime.
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    // The unscoped Prisma client bypasses tenant isolation. Only auth flows
    // (which run before a tenant is known) and src/system (cross-tenant lookups) may touch it.
    files: ["src/**/*.ts"],
    ignores: [
      "src/auth/**",
      "src/invitations/**",
      "src/prisma/**",
      "src/health/**",
      "src/system/**",
      "src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='unscoped']",
          message: "Use prisma.db (tenant-scoped). The unscoped client is reserved for auth/system code.",
        },
      ],
    },
  },
];
