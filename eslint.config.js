import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "vendor/", "node_modules/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: { ...globals.browser, chrome: "readonly" } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Tunables belong in src/shared/config.js. Allowed: small counts, ±1, percentages, CSS-ish values.
      "no-magic-numbers": [
        "warn",
        {
          ignore: [-1, 0, 0.5, 1, 2, 10, 100, 1000, 360, 180, 90],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
    },
  },
  {
    files: [
      "src/shared/config.js",
      "src/infrastructure/audio/piper-synthesizer.js",
      "src/infrastructure/view-controls.js",
      "src/domain/actions.js",
      "src/domain/settings.js",
      "src/presentation/**",
    ],
    rules: { "no-magic-numbers": "off" },
  },
  {
    files: ["test/**/*.js", "scripts/**/*.js", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
];
