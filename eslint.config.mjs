import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import tseslintBase from 'typescript-eslint'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/local-notes'] },
  // Type-AWARE linting (audit W7): recommendedTypeChecked adds the rules that
  // need type info — no-floating-promises, no-misused-promises, unsafe-* —
  // the bug class that matters most in a credential-handling app.
  tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // vitest.config.ts belongs to no tsconfig project; lint it against the
        // default project instead of erroring.
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    // Mock-heavy test code trips the unsafe-* family and unbound-method
    // structurally (vi.fn() is `any`-shaped; `expect(mock.method)` is the
    // standard assert pattern), and typed-mock plumbing would add noise, not
    // safety. PRODUCTION code keeps the full type-checked rule set.
    files: ['**/*.test.{ts,tsx}', '**/__testutils__/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-misused-promises': 'off'
    }
  },
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // Plain JS (build/release scripts like scripts/*.mjs) can't carry TypeScript
    // type annotations or participate in type-aware linting.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslintBase.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // src/shared purity backstop (audit W7): shared code bundles into the
    // SANDBOXED renderer — an electron/node import there is a runtime break
    // that typecheck alone won't catch. Lint makes the contract mechanical.
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'src/shared is PURE (bundles into the sandboxed renderer) — no electron imports. See src/shared/AGENTS.md.'
            }
          ],
          patterns: [
            {
              // electron subpaths + node builtins, both bare and node:-prefixed
              // (bare-name gaps found by the W7 adversarial review probe).
              group: [
                'electron/*',
                'node:*',
                'fs',
                'path',
                'os',
                'crypto',
                'child_process',
                'http',
                'https',
                'net',
                'events',
                'util',
                'stream',
                'buffer',
                'url',
                'assert',
                'zlib',
                'worker_threads',
                'process',
                'tls',
                'dns'
              ],
              message:
                'src/shared is PURE (bundles into the sandboxed renderer) — no node builtins. See src/shared/AGENTS.md.'
            }
          ]
        }
      ]
    }
  },
  eslintConfigPrettier
)
