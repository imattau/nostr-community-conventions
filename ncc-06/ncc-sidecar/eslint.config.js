import js from '@eslint/js';
import { defineConfig } from 'eslint/config';

const recommended = js.configs.recommended;

export default defineConfig({
  ...recommended,
  ignores: [
    'node_modules/',
    'ui/',
    'certs/',
    '*.db',
    '*.json',
    'read-logs.js',
    'check-services.js',
    'onion-service.json.bak'
  ],
  languageOptions: {
    ...recommended.languageOptions,
    ecmaVersion: 'latest',
    sourceType: 'module',
    globals: {
      ...(recommended.languageOptions?.globals || {}),
      console: 'readonly',
      process: 'readonly',
      URL: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly'
    }
  },
  rules: {
    ...recommended.rules,
    'no-console': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    semi: ['error', 'always']
  }
});
