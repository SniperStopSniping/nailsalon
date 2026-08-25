import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
  },
  css: {
    postcss: { plugins: [] },
  },
  // Vite 5 requires a string here; this deliberately nonexistent package-local
  // directory prevents discovery of Luster's root environment files.
  envDir: './.lab-env-disabled',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true,
  },
});
