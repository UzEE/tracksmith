import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignorePatterns: ['CLAUDE.md', 'docs/**'],
    singleQuote: true,
    sortImports: {
      groups: [
        'builtin',
        'type',
        'external',
        { newlinesBetween: true },
        ['parent', 'sibling', 'index'],
        'unknown'
      ],
      sortSideEffects: false
    },
    trailingComma: 'none'
  },
  lint: {
    categories: {
      correctness: 'warn',
      perf: 'warn',
      suspicious: 'warn'
    },
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    plugins: ['eslint', 'oxc', 'typescript', 'unicorn'],
    rules: {
      'eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none'
        }
      ],
      'typescript/await-thenable': 'off',
      'typescript/no-explicit-any': 'error',
      'vite-plus/prefer-vite-plus-imports': 'error'
    },
    options: { typeAware: true, typeCheck: true }
  }
});
