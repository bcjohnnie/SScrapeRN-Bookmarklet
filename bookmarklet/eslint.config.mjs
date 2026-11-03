// Security lint rules. Also lints the extension, which shares most of this code.
import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import nounsanitized from 'eslint-plugin-no-unsanitized';

export default [
  js.configs.recommended,
  security.configs.recommended,
  nounsanitized.configs.recommended,
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'dist/**', 'test-build/**', 'test/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
];
