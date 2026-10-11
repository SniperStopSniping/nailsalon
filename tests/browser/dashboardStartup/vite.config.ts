import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');
export default defineConfig({ root, envDir: root, define: { 'process.env': {} }, cacheDir: path.join(os.tmpdir(), 'luster-dashboard-startup-cache'), plugins: [react()], resolve: { alias: {
  '@clerk/nextjs': path.join(root, 'clerk.ts'),
  'next/link': path.join(repository, 'tests/browser/ownerEntry/link.tsx'),
  'next/image': path.join(repository, 'tests/browser/appointmentWorkflow/next-image.tsx'),
  'next/navigation': path.join(root, 'navigation.ts'),
  '@': path.join(repository, 'src'),
} }, server: { host: '127.0.0.1', port: 3171, strictPort: true, fs: { allow: [repository] } } });
