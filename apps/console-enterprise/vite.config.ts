import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * `@console-shared` lives in `packages/console-shared/` outside this app's root.
 * Alias it so Vite resolves imports correctly.
 */
const dep = (name: string) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url))
const consoleShared = fileURLToPath(new URL(`../../packages/console-shared/src`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: dep('react') },
      { find: /^react\/jsx-runtime$/, replacement: dep('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: dep('react/jsx-dev-runtime') },
      { find: /^react-router-dom$/, replacement: dep('react-router-dom') },
      { find: /^@console-shared\/(.*)$/, replacement: `${consoleShared}/$1` },
    ],
  },
})
