// Vite+ per-package settings, matching the other Workers in this repository. `vitest.config.ts`
// beside this file is vitest's own config; this file exists only to declare the `build` and `test`
// tasks that `vp run` executes.

// This package's own `tsc` output.
const ownDist = { pattern: '!dist/**', base: 'package' } as const

// Written and read back by every vitest run, so without these almost nothing caches.
const vitestScratch = [
  { pattern: '!**/node_modules/.vite/**', base: 'workspace' },
  { pattern: '!**/node_modules/.vite-temp/**', base: 'workspace' },
  { pattern: '!**/.wrangler/**', base: 'workspace' },
] as const

export default {
  run: {
    tasks: {
      build: {
        command: 'tsc',
        input: [{ auto: true }, ownDist],
        output: ['dist/**'],
      },
      test: {
        command: 'vitest run',
        input: [{ auto: true }, ownDist, ...vitestScratch],
        output: [{ auto: true }, ownDist, ...vitestScratch],
      },
    },
  },
}
