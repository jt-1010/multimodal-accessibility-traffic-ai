import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MediaPipe WASM glue and the generated migration SQL: not ours
    // to lint, and 700+ warnings from them hide real findings in our code.
    "public/**",
    "drizzle/**",
    ".pglite/**",
  ]),
]);

export default eslintConfig;
