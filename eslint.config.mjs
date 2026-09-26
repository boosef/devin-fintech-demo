import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/coverage/**", "**/.next/**", "test-results.json"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    // team-apps are employee-built tools: they reach core app data only through
    // a core app's published API, never by importing app internals — not even
    // via relative paths that escape team-apps/ or "@/..." aliases.
    files: ["team-apps/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "apps",
                "apps/**",
                "**/apps/**",
                "@/**",
                "@acme/refunds-dashboard",
                "@acme/refunds-dashboard/**",
              ],
              message:
                "team-apps may not import from apps/** or a core app's internals; depend on the core app's published API instead.",
            },
          ],
        },
      ],
      // same boundary for require()
      "no-restricted-modules": [
        "error",
        {
          patterns: [
            "apps",
            "apps/**",
            "**/apps/**",
            "@/**",
            "@acme/refunds-dashboard",
            "@acme/refunds-dashboard/**",
          ],
        },
      ],
    },
  },
);
