/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// The game builds as a claude.ai artifact (scripts/build-artifact.mjs); this config serves
// `npm run dev` and the tests.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify('dev') },
  test: { include: ['tests/**/*.test.ts'] },
});
