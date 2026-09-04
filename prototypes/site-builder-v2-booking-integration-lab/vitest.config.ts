import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  plugins: [react()],
  test: {
    coverage: {
      include: ['src/{booking,model,onboarding,ui}/**/*.{ts,tsx}'],
    },
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{labtest,test,unit}.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
