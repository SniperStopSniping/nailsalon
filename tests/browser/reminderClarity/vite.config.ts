import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

// Actual reminder component with intercepted settings responses. No app server,
// database, authentication provider or message delivery provider is used here.
export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-reminder-clarity-vite-cache'),
  plugins: [react()],
  resolve: { alias: { '@': path.join(repository, 'src') } },
  server: { host: '127.0.0.1', port: 3142, strictPort: true, fs: { allow: [repository] } },
});
