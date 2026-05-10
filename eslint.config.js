import tseslint from 'typescript-eslint';
import angulareslint from 'angular-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', '.idea/', '*.spec.ts'],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      '@angular-eslint': angulareslint,
    },
    rules: {
      ...angulareslint.configs.tsRecommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@angular-eslint/component-class-suffix': 'off',
      '@angular-eslint/directive-class-suffix': 'off',
      '@angular-eslint/no-empty-lifecycle-method': 'off',
      '@angular-eslint/use-injectable-function-or-provider': 'off',
    },
  },
);