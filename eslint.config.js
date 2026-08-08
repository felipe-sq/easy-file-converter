const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", "bin/**", "out/**", "dist/**"],
  },
  // Main process and anything else that runs under Node.
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      // The settings helpers deliberately swallow parse errors and fall back to
      // defaults, so bare `catch {}` blocks are intentional here.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  // The renderer runs in the browser context with no Node access.
  {
    files: ["renderer.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // The preload bridge straddles both: Node `require` plus browser globals.
  {
    files: ["preload.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.nodeBuiltin },
    },
  },
];
