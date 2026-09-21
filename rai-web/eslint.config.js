// One lint configuration for all five workspaces (W0-02 section 1). Type-aware typescript-eslint rules everywhere;
// React, hooks and jsx-a11y rules (errors, not warnings) in web/; `react/jsx-no-literals` enforces the section 10
// no-hard-coded-string rule; `no-restricted-imports` blocks the legacy demo/; `no-restricted-syntax` blocks skipped
// or todo tests under tests/ (section 6). Prettier runs separately (`prettier --check`), so formatting rules are off.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

const demoImports = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['../demo', '../demo/*', '../../demo', '../../demo/*', '**/demo/**'],
          message: 'demo/ is reference only; never imported by rai-web (W0-02 section 1.1)',
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.local/**',
      'playwright-report/**',
      'test-results/**',
      'server/drizzle/**',
      'web/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...demoImports,
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          // node:test registration functions return a promise the runner owns; a test file need not await them.
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: ['test', 'describe', 'it', 'suite', 'before', 'after', 'beforeEach', 'afterEach'],
            },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Tool configuration files and the zero-dependency scripts sit outside the five tsconfig projects.
    files: [
      '**/*.mjs',
      '**/*.js',
      'web/vite.config.ts',
      'server/drizzle.config.ts',
      'tests/browser/playwright.config.ts',
    ],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    settings: { react: { version: '19.3' } },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    ...react.configs.flat['jsx-runtime'],
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // Section 10 rule 2: no hard-coded user-facing string; text and the named attributes must come from t().
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          allowedStrings: [
            '-',
            '–',
            '—',
            ':',
            '/',
            '(',
            ')',
            '.',
            ',',
            '%',
            '0',
            '1',
            '2',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
          ],
          ignoreProps: false,
          noAttributeStrings: true,
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.object.name=/^(describe|test|it)$/][callee.property.name=/^(skip|todo|only)$/]',
          message: 'No skipped, todo or focused tests merge to main (W0-02 section 6)',
        },
      ],
    },
  },
  prettier,
);
