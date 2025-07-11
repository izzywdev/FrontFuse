module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  rules: {
    'no-unused-vars': 'off',
    'no-undef': 'off',
    'no-console': 'off',
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
};