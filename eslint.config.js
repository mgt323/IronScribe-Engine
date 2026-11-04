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
