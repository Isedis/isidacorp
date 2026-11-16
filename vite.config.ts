/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Unique per build: the commit on CI, the time locally.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) ?? `local-${Date.now()}`;

// GitHub Pages serves the game from /isidacorp/.
export default defineConfig({
  base: '/isidacorp/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [{
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  }],
  test: { include: ['tests/**/*.test.ts'] },
});
