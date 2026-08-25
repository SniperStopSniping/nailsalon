import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  test: {
    coverage: {
      include: ['src/model/**/*.ts'],
    },
    environment: 'node',
    include: ['src/**/*.labtest.ts'],
  },
});
