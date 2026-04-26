import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "output/**",
      "node_modules/**",
      // Docusaurus + copied static under public (not maintained by hand)
      "docs-site/.docusaurus/**",
      "docs-site/build/**",
      "public/docs/**",
      // small CommonJS services / scripts
      "windows-upload-service/**",
      "**/*.cjs",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
