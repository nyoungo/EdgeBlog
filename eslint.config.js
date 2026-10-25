import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Flat config (ESLint 9). Covers three surfaces:
 *   src/       React + browser globals
 *   functions/ Cloudflare Workers (Web APIs, no DOM)
 *   shared/    Isomorphic types + defaults used by both
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'coverage/**'],
  },
  {
    // Declaring the extensions here is what makes `eslint .` pick up .ts/.tsx.
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Every page module exports its page component plus small helpers.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['functions/**/*.ts', 'shared/**/*.ts', 'scripts/**/*.{js,mjs}', '*.{js,ts}'],
    languageOptions: {
      globals: { ...globals.worker, ...globals.node },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
