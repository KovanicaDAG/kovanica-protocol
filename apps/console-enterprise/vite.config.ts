import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * `@console-shared` lives in `packages/console-shared/` outside this app's root.
 * Alias it so Vite resolves imports correctly.
 *
 * react / react-dom / react-router-dom are deliberately NOT aliased to this
 * app's own node_modules: the repo is a single npm workspace, so those packages
 * are hoisted to the workspace root and Vite's normal resolution finds the one
 * instance.
 */
const consoleShared = fileURLToPath(new URL(`../../packages/console-shared/src`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@console-shared\/(.*)$/, replacement: `${consoleShared}/$1` },
    ],
  },
})
