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
    globals: true, // This is needed by @testing-library to be cleaned up after each test
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    coverage: {
      include: ['src/**/*'],
      exclude: ['src/**/*.stories.{js,jsx,ts,tsx}', '**/*.d.ts'],
    },
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['src/hooks/**/*.test.ts', 'jsdom'],
    ],
    setupFiles: ['./vitest-setup.ts'],
    env: testEnv,
  },
});
