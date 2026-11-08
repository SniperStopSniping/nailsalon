import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve('tests/browser/customerPayments'),
  plugins: [react()],
  resolve: { alias: { '@': path.resolve('src') } },
  server: { host: '127.0.0.1', port: 3199, strictPort: true, fs: { allow: [process.cwd()] } },
});
