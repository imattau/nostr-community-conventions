import { fileURLToPath, URL } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import globals from 'globals';
import pkg from '@eslint/js';

const { configs } = pkg;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname, recommendedConfig: configs.recommended });
const envGlobals = {
  ...globals.es2020,
  ...globals.node
};

export default [
  ...compat.extends('eslint:recommended'),
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: envGlobals
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_'
        }
      ]
    }
  }
];
