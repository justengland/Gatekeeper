module.exports = {
  extends: ['standard-with-typescript'],
  parserOptions: {
    project: './tsconfig.json'
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/strict-boolean-expressions': 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'off'
  },
  ignorePatterns: ['dist/**', '**/*.test.ts']
}
