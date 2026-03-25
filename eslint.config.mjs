import antfu from '@antfu/eslint-config';
import nextPlugin from '@next/eslint-plugin-next';
import jestDom from 'eslint-plugin-jest-dom';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import playwright from 'eslint-plugin-playwright';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tailwind from 'eslint-plugin-tailwindcss';
import testingLibrary from 'eslint-plugin-testing-library';

export default antfu({
  react: true,
  typescript: true,

  lessOpinionated: true,
  isInEditor: false,

  stylistic: {
    semi: true,
  },

  formatters: {
    css: true,
  },

  ignores: [
    'migrations/**/*',
    'next-env.d.ts',
  ],
}, ...tailwind.configs['flat/recommended'], jsxA11y.flatConfigs.recommended, {
  plugins: {
    '@next/next': nextPlugin,
  },
  rules: {
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
  },
}, {
  plugins: {
    'simple-import-sort': simpleImportSort,
  },
  rules: {
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
  },
}, {
  files: [
    '**/*.test.ts?(x)',
  ],
  ...testingLibrary.configs['flat/react'],
  ...jestDom.configs['flat/recommended'],
}, {
  files: [
    '**/*.spec.ts',
    '**/*.e2e.ts',
  ],
  ...playwright.configs['flat/recommended'],
}, {
  rules: {
    'import/order': 'off', // Avoid conflicts with `simple-import-sort` plugin
    'sort-imports': 'off', // Avoid conflicts with `simple-import-sort` plugin
    'style/brace-style': ['error', '1tbs'], // Use the default brace style
    'ts/consistent-type-definitions': ['error', 'type'], // Use `type` instead of `interface`
    'react/prefer-destructuring-assignment': 'off', // Vscode doesn't support automatically destructuring, it's a pain to add a new variable
    'node/prefer-global/process': 'off', // Allow using `process.env`
    'node/prefer-global/buffer': 'off', // Allow using global Buffer in Node.js API routes
    'no-console': ['error', { allow: ['warn', 'error'] }], // Allow console.warn/error for server-side debugging
    'no-alert': 'off', // Allow confirm/alert for critical destructive actions (no toast system yet)
    'jsx-a11y/no-autofocus': 'off', // AutoFocus is a UX decision, not always bad
    'jsx-a11y/label-has-associated-control': ['error', {
      assert: 'either', // Allow either nesting or htmlFor
      depth: 3, // Allow nested inputs up to 3 levels deep
    }],
    'test/padding-around-all': 'error', // Add padding in test files
    'test/prefer-lowercase-title': 'off', // Allow using uppercase titles in test titles
  },
});
