import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const systemPackages = ['@iron-scribe/system-dnd5e-2024', '@iron-scribe/system-daggerheart'];
const outerPackages = ['@iron-scribe/llm', '@iron-scribe/orchestrator', ...systemPackages];

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'pnpm-lock.yaml', '**/*.gguf'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['packages/dice/**/*.{ts,tsx}', 'packages/engine-core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: outerPackages.map((name) => ({
            name,
            message:
              'Core packages depend only inward. Do not import LLM, orchestrator, or system packages.',
          })),
        },
      ],
    },
  },
  {
    files: ['packages/system-*/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@iron-scribe/llm',
              message: 'Rules packages must not import the LLM client.',
            },
            {
              name: '@iron-scribe/orchestrator',
              message: 'Rules packages must not import the orchestrator.',
            },
          ],
        },
      ],
    },
  },
  // Handwritten code: 300-line limit (style). Copied upstream code is exempt below.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  // Handwritten catalog code may use upstream *types* but must never run upstream schemas
  // (committed data is validated in srd:import and in tests, not at load).
  {
    files: ['packages/system-dnd5e-2024/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/system-dnd5e-2024/src/catalog/upstream/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/upstream/**'],
              allowTypeImports: true,
              message: 'Production code may only type-import copied upstream schemas.',
            },
          ],
        },
      ],
    },
  },
  // Copied upstream code (written only by srd:import): style rules off, correctness on.
  // tsc still typechecks it; imports are limited to zod and relative paths.
  {
    files: ['packages/system-dnd5e-2024/src/catalog/upstream/**/*.ts'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'max-lines': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@iron-scribe/llm', message: 'Rules packages must not import the LLM client.' },
            {
              name: '@iron-scribe/orchestrator',
              message: 'Rules packages must not import the orchestrator.',
            },
          ],
          patterns: [
            {
              group: ['@iron-scribe/*', 'node:*'],
              message: 'Copied upstream code may import only zod and relative paths.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/llm/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@iron-scribe/dice',
              message: 'LLM client must not depend on game packages.',
            },
            {
              name: '@iron-scribe/engine-core',
              message: 'LLM client must not depend on game packages.',
            },
            {
              name: '@iron-scribe/orchestrator',
              message: 'LLM client must not depend on the orchestrator.',
            },
            ...systemPackages.map((name) => ({
              name,
              message: 'LLM client must not depend on game packages.',
            })),
          ],
        },
      ],
    },
  },
  {
    files: ['packages/orchestrator/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: systemPackages.map((name) => ({
            name,
            message: 'Orchestrator knows RuleSystem, not a concrete ruleset.',
          })),
        },
      ],
    },
  },
);
