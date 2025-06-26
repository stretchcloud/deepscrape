const typescriptParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: typescriptParser,
    },
    rules: {
      // Basic rules only
      "no-unused-vars": "off", // Turn off base rule to avoid conflicts
      "prefer-const": "error",
      
      // Code style - relaxed for TypeScript
      "quotes": ["error", "single", { "allowTemplateLiterals": true }],
      "semi": ["error", "always"],
      "no-trailing-spaces": "error",
      "eol-last": "error",
      
      // Best practices
      "no-console": "off", // Allow console for logging
      "no-debugger": "error",
      "no-duplicate-imports": "error",
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Basic JavaScript rules
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "prefer-const": "error",
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "no-trailing-spaces": "error",
      "eol-last": "error",
      "no-console": "off",
      "no-debugger": "error",
      "no-duplicate-imports": "error",
    },
  },
];