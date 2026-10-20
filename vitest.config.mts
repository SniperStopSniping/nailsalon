import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Local .env files may point DATABASE_URL at a real development database.
// Tests must always run on the isolated in-memory PGlite database, so the
// connection string is stripped before the env reaches any test worker.
// (vitest-setup.ts also deletes shell-inherited values, and src/libs/DB.ts
// refuses to open a real connection under Vitest as a final backstop.)
const testEnv = loadEnv('', process.cwd(), '');
delete testEnv.DATABASE_URL;

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // next-intl v4 is ESM and imports Next's extensionless entry points.
    // Let Vite resolve those imports as Next does instead of Node's ESM loader.
    server: { deps: { inline: ['next-intl'] } },
    globals: true, // This is needed by @testing-library to be cleaned up after each test
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/**/*.stories.{js,jsx,ts,tsx}', '**/*.d.ts'],
    },
    projects: [
      {
        // Inline projects do not inherit root Vite/test options in Vitest 4
        // unless extends is explicit. Keep the root setup, env, plugin and
        // Next Intl transform active in both environments.
        extends: true,
        test: {
          name: 'node',
          include: [
            'src/**/*.test.{js,jsx,ts,tsx}',
            // P8a operator-script pure guard tests live beside the scripts
            // they guard, not under src/.
            'scripts/**/*.test.{js,ts}',
          ],
          exclude: ['src/**/*.test.tsx', 'src/hooks/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          include: ['src/**/*.test.tsx', 'src/hooks/**/*.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
    setupFiles: ['./vitest-setup.ts'],
    env: testEnv,
  },
});
