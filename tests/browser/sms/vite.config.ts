import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

// Component-only browser harness: no Next server, auth, database or provider.
export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-sms-vite-cache'),
  envDir: root,
  plugins: [react()],
  resolve: { alias: { 'next/navigation': path.join(root, 'navigation.ts'), '@': path.join(repository, 'src') } },
  server: { host: '127.0.0.1', port: 3127, strictPort: true, fs: { allow: [repository] } },
});
