import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * `../shared/src` lives outside this app's root, so Vite resolves its bare
 * imports by walking up from `mobile/console/shared/` — which has no
 * `node_modules` — and never finds React. The build fails with
 * "Rollup failed to resolve import 'react'".
 *
 * Aliasing the three specifiers shared code actually uses (plus the JSX
 * runtime the transform injects) points them back at this app's install.
 * Matches are anchored on both ends so `react-dom` can never be captured by
 * the `react` entry.
 */
const dep = (name: string) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: dep('react') },
      { find: /^react\/jsx-runtime$/, replacement: dep('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: dep('react/jsx-dev-runtime') },
      { find: /^react-router-dom$/, replacement: dep('react-router-dom') },
    ],
  },
})
