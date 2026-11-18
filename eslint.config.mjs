import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  // The database is async: a forgotten `await` would silently skip a write or return a promise.
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  // App code reaches the database only as the signed-in user (userDb / pageDb in src/lib/auth/request.ts).
  // The unscoped root handle is for that file, scripts and tests.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/admin", "**/db/admin"],
              message:
                "Use userDb()/pageDb() from @/lib/auth/request: the root database handle is not scoped to a user.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/auth/request.ts", "src/**/*.test.{ts,tsx}", "src/db/**"],
    rules: { "no-restricted-imports": "off" },
  },
  // Code that runs in the browser never imports the bank client (it signs with the private key) or anything built on
  // it; only the browser-safe view types. src/lib/banking/client-guard.test.ts checks every "use client" file as well.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/client/**/*.{ts,tsx}", "src/i18n/client.tsx"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db/admin", "**/db/admin"],
              message:
                "Use userDb()/pageDb() from @/lib/auth/request: the root database handle is not scoped to a user.",
            },
            {
              group: [
                "@/lib/banking/*",
                "!@/lib/banking/types",
                "**/lib/banking/*",
                "!**/lib/banking/types",
              ],
              message:
                "The bank client is server-only (it holds the private key). Browser code may import @/lib/banking/types only.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
