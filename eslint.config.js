import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore is the standard convention for "required by
      // an interface signature but intentionally unused" -- e.g. a
      // provider-adapters mock matching a method signature it doesn't
      // need every parameter of.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  }
);
