// @ts-check
const nextConfig = require('eslint-config-next/core-web-vitals'); // eslint-disable-line @typescript-eslint/no-require-imports
const nextTypeScript = require('eslint-config-next/typescript'); // eslint-disable-line @typescript-eslint/no-require-imports

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: ['dist/**'],
  },
  ...nextConfig,
  ...nextTypeScript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      // Downgrade new rule from react-hooks v7 — existing pattern is safe for client-side init
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

module.exports = config;
