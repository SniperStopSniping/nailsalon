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
  cacheDir: path.join(os.tmpdir(), 'luster-onboarding-direct-offer-cache'),
  plugins: [react()],
  define: { 'process.env': {} },
  // The Canva editor is lazy-loaded. Prebundle its drag-and-drop dependencies
  // with the initial React graph, so opening it cannot introduce a second hook
  // dispatcher after the owner-entry screens have already rendered.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'] },
  resolve: { dedupe: ['react', 'react-dom'], alias: {
    '@clerk/nextjs/legacy': path.join(repository, 'tests/browser/ownerAccountRecovery/clerk.ts'),
    '@clerk/nextjs': path.join(repository, 'tests/browser/ownerAccountRecovery/clerk.ts'),
    'next/link': path.join(repository, 'tests/browser/ownerEntry/link.tsx'),
    'next/image': path.join(repository, 'tests/browser/appointmentWorkflow/next-image.tsx'),
    'next/navigation': path.join(repository, 'tests/browser/ownerAccountRecovery/navigation.ts'),
    '@': path.join(repository, 'src'),
  } },
  server: { host: '127.0.0.1', port: 3191, strictPort: true, fs: { allow: [repository] } },
});
