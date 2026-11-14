import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import tseslintBase from 'typescript-eslint'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintReact from '@eslint-react/eslint-plugin'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

/**
 * Electron subpaths and the Node builtins, bare and `node:`-prefixed. Shared
 * by the two blocks below that keep them out of sandboxed code. `electron`
 * itself is named in each block's `paths`.
 */
const ELECTRON_AND_NODE_MODULES = [
  'electron/*',
  'node:*',
  'node:*/*',
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
  'dns',
  'timers',
  'fs/*',
  'path/*',
  'os/*',
  'crypto/*',
  'child_process/*',
  'http/*',
  'https/*',
  'net/*',
  'events/*',
  'util/*',
  'stream/*',
  'buffer/*',
  'url/*',
  'assert/*',
  'zlib/*',
  'worker_threads/*',
  'process/*',
  'tls/*',
  'dns/*',
  'timers/*'
]

export default defineConfig(
  // '**/.claude': agent worktrees live under .claude/worktrees — flat config
  // ignores .gitignore, so without this a live agent checkout breaks main-tree lint.
  // Coverage reporters emit vendored JavaScript, not authored source.
  {
    ignores: ['**/node_modules', '**/dist', '**/out', '**/local-notes', '**/.claude', 'coverage/**']
  },
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
  {
    // eslint-plugin-react 7.37 does not load on ESLint 10 (`context.getFilename`
    // is gone). @eslint-react's type-checked preset covers JSX and component
    // rules and does not require `React` in scope. Its extra style rules
    // (ref names, forwardRef, use() vs useContext, hook naming) describe a
    // different component style than the previous preset; react-hooks stays
    // the source for hook dependencies and effect setState.
    files: ['**/*.{ts,tsx}'],
    ...eslintReact.configs['recommended-type-checked'],
    rules: {
      ...eslintReact.configs['recommended-type-checked'].rules,
      '@eslint-react/naming-convention-ref-name': 'off',
      '@eslint-react/no-forward-ref': 'off',
      '@eslint-react/no-use-context': 'off',
      '@eslint-react/use-state': 'off',
      '@eslint-react/purity': 'off',
      '@eslint-react/no-array-index-key': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/dom-no-flush-sync': 'off'
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
    // These standalone guide entries mount document roots. The docs Vite build
    // uses ordinary module reloads rather than React Fast Refresh.
    files: ['docs/guide/scene-entry.tsx', 'docs/guide/scene-renderer.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' }
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
              group: ELECTRON_AND_NODE_MODULES,
              message:
                'src/shared is PURE (bundles into the sandboxed renderer) — no node builtins. See src/shared/AGENTS.md.'
            },
            {
              group: [
                '**/main',
                '**/main/**',
                '**/preload',
                '**/preload/**',
                '**/renderer',
                '**/renderer/**',
                '@renderer/*'
              ],
              message:
                'src/shared is imported by every process and imports none of them. Move the shared part into src/shared. See src/shared/AGENTS.md.'
            }
          ]
        }
      ]
    }
  },
  {
    // Process boundary, renderer side. The renderer is sandboxed: Electron and
    // Node modules do not exist there, and main-process code must never be
    // bundled into it. TypeScript alone lets such an import compile, so lint
    // makes the boundary mechanical. Data crosses through `window.vrx` and the
    // types in `@shared/ipc`.
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'The renderer is sandboxed and has no Electron. Call main through window.vrx (src/preload) instead. See src/renderer/AGENTS.md.'
            }
          ],
          patterns: [
            {
              group: ELECTRON_AND_NODE_MODULES,
              message:
                'The renderer is sandboxed and has no Electron or Node modules. See src/renderer/AGENTS.md.'
            },
            {
              group: ['**/main', '**/main/**', '**/preload', '**/preload/**'],
              message:
                'The renderer never imports main-process or preload code. Share types and pure helpers through src/shared (@shared). See src/renderer/AGENTS.md.'
            }
          ]
        }
      ]
    }
  },
  {
    // Process boundary, main side: main and preload never import renderer
    // code. Tests may borrow a renderer fixture or reducer to check both ends
    // of a contract together.
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__testutils__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/renderer', '**/renderer/**', '@renderer/*'],
              message:
                'Main and preload never import renderer code. Share types and pure helpers through src/shared (@shared). See src/main/AGENTS.md.'
            }
          ]
        }
      ]
    }
  },
  {
    // App code logs through the redacting logger (src/main/logger.ts), which
    // strips credentials and personal data; `console` skips it. The renderer
    // has no log sink at all: show the user a message instead.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/__testutils__/**'],
    rules: { 'no-console': 'error' }
  },
  eslintConfigPrettier
)
