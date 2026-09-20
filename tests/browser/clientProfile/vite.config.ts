import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-client-profile-vite-cache'),
  plugins: [react()],
  resolve: {
    alias: {
      'next/image': path.join(repository, 'tests/browser/appointmentWorkflow/next-image.tsx'),
      'next/navigation': path.join(repository, 'tests/browser/appointmentWorkflow/navigation.ts'),
      '@/providers/SalonProvider': path.join(root, 'salon-provider.tsx'),
      '@': path.join(repository, 'src'),
    },
  },
  server: { host: '127.0.0.1', port: 3148, strictPort: true, fs: { allow: [repository] } },
});
