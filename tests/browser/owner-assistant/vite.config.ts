import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

// Component-only harness. The spec intercepts every /api call; it cannot use
// a Next server, Clerk session, database, or provider credentials.
export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-owner-assistant-vite-cache'),
  plugins: [react()],
  resolve: { alias: { '@': path.join(repository, 'src') } },
  server: { host: '127.0.0.1', port: 3137, strictPort: true, fs: { allow: [repository] } },
});
