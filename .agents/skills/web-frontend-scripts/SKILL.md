---
name: web-frontend-scripts
description: The agent should use this skill to run various development, build, and testing tasks for the Kovanica web frontend.
---

# Web Frontend Scripts

The `web/package.json` file contains several npm scripts to aid in the development and deployment of the frontend application. These should be run from the `web` directory.

## Core Workflows

- **Development Server**: `npm run dev`
  - Starts the Vite development server with the app environment loaded.
- **Production Build**: `npm run build`
  - Builds the Vite application and runs database migrations (`npm run db:migrate`).
- **Preview**: `npm run preview`
  - Previews the built application.
- **VPS Build**: `npm run build:vps`
  - Builds the app with the `NITRO_PRESET=node-server` environment variable, specifically for VPS deployments.

## Testing and Linting

- **Typecheck**: `npm run typecheck`
  - Runs TypeScript compiler to check for type errors without emitting files.
- **Test**: `npm run test`
  - Runs the test suites defined in `scripts/**/*.test.mjs` and `src/lib/**/*.test.ts`.
- **Lint**: `npm run lint`
  - Runs ESLint to find and fix problems in the codebase.
- **Format**: `npm run format`
  - Runs Prettier to format the codebase.
- **Check Auth**: `npm run check:auth`
  - Validates authentication invariants using the `check-auth-invariant.mjs` script.
