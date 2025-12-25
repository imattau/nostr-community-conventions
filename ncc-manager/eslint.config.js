import globals from "globals";
import pluginJs from "@eslint/js";
import babelParser from "@babel/eslint-parser";

export default [
  // Global ignores
  {
    ignores: ["dist/", "bin/", "node_modules/"]
  },

  // Base configuration for all JS files (mostly browser context)
  {
    files: ["**/*.js"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: "module",
        requireConfigFile: false,
        babelOptions: {} // Empty as Vite handles Babel
      },
      globals: {
        ...globals.browser, // Browser globals (window, document, console, setTimeout, etc.)
        ...globals.es2021   // ES2021 globals (Promise, Map, Set, etc.)
      }
    },
    rules: {
      ...pluginJs.configs.recommended.rules,
      "no-unused-vars": ["warn", { 
        "argsIgnorePattern": "^_", 
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }],
      "no-console": ["warn", { "allow": ["warn", "error", "info"] }],
      "no-undef": "error" // Re-enable no-undef to catch actual undefined variables
    }
  },

  // Node.js specific configuration (for server.js and server_store.js)
  {
    files: ["server.js", "src/server_store.js"],
    languageOptions: {
      globals: {
        ...globals.node // Node.js globals (process, require, module, etc.)
      }
    },
    rules: {
      "no-console": ["warn", { "allow": ["warn", "error", "info"] }]
    }
  },

  // Web Worker specific configuration (for validationWorker.js)
  {
    files: ["src/workers/validationWorker.js"],
    languageOptions: {
      globals: {
        ...globals.worker // Web Worker globals (self, postMessage, etc.)
      }
    },
    rules: {
      "no-console": ["warn", { "allow": ["warn", "error", "info"] }]
    }
  },

  // Test files specific configuration
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.jest // For Jest test globals (describe, it, expect, etc.)
      }
    },
    rules: {
      "no-console": ["off"], // Allow console in tests
      "no-undef": "off",     // Temporarily turn off no-undef in tests for flexibility
      "no-unused-vars": "off" // Temporarily turn off unused-vars in tests
    }
  },

  // Further overrides for specific files or patterns if necessary
  {
    files: ["src/main.js"],
    rules: {
      // 'state' is not defined (global for the app)
      "no-undef": ["error", { "typeof": true }] // Ensure typeof operator check for global 'state'
    }
  }
];