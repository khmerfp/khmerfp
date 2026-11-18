// configure lint rules for the standalone browser test tools.
﻿import js from '@eslint/js'
import globals from 'globals'
export default [
  { ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['**/*.js'], ...js.configs.recommended,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
]
