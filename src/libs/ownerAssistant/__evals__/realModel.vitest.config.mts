/**
 * Vitest config for the REAL-MODEL eval run ONLY (A1-4, deliverable F).
 *
 * The repo's own `vitest.config.mts` is what CI runs; it collects
 * `src/**‍/*.test.ts`, and `realModelRun.ts` deliberately does NOT match that
 * pattern, so CI can never pick it up. This config exists to run that one file
 * on purpose, and is used only by `scripts/owner-assistant-eval.ts`.
 *
 * Why Vitest at all, for something that is not a test: the Owner Assistant turn
 * loop cannot be loaded by `tsx`. `@/libs/DB` uses TOP-LEVEL AWAIT, and a `.ts`
 * file in this repo is CommonJS (package.json declares no `"type": "module"`),
 * which esbuild cannot emit top-level await into — and every module in the
 * graph carries `import 'server-only'`, which throws outside the `react-server`
 * condition. Vitest's transform pipeline handles both, and the PGlite bootstrap
 * it gives us is the SAME one the CI eval suite already proves. Running the
 * real loop through it is therefore less machinery and more fidelity than any
 * bespoke loader would be.
 *
 * `fileParallelism: false` and the long timeouts are because every "test" here
 * is one or more live model round trips.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: [path.join(here, 'realModelRun.ts')],
    setupFiles: [path.join(here, 'realModel.setup.ts')],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // Never let this run be reported as repo coverage.
    coverage: { enabled: false },
  },
});
