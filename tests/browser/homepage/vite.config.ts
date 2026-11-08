import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');
export default defineConfig({
  root,
  envDir: root,
  publicDir: path.join(repository, 'public'),
  plugins: [react()],
  resolve: { alias: {
    'next/link': path.join(repository, 'tests/browser/ownerEntry/link.tsx'),
    'next/image': path.join(repository, 'tests/browser/booking-theme/image.tsx'),
    'next/navigation': path.join(repository, 'tests/browser/appointmentWorkflow/navigation.ts'),
    '@clerk/nextjs': path.join(repository, 'tests/browser/clerk.ts'),
    '@': path.join(repository, 'src'),
  } },
  server: { host: '127.0.0.1', port: 3191, strictPort: true, fs: { allow: [repository] } },
});
