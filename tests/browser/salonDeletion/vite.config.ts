import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');
export default defineConfig({
  root,
  envDir: root,
  cacheDir: path.join(os.tmpdir(), 'luster-deletion-review-vite-cache'),
  plugins: [react()],
  resolve: { alias: { '@': path.join(repository, 'src') } },
  server: { host: '127.0.0.1', port: 3196, strictPort: true, fs: { allow: [repository] } },
});
