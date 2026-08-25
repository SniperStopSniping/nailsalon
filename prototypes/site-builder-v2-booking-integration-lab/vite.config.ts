import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serviceImageDirectory = fileURLToPath(
  new URL('../../public/assets/images/services', import.meta.url),
);

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
  publicDir: serviceImageDirectory,
  server: {
    host: '127.0.0.1',
    port: 4182,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4182,
    strictPort: true,
  },
});
