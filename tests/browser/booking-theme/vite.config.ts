import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

// Isolated UI fixture. Only framework adapters and the server-only content
// resolver are substituted; the shell, providers, screens and CSS are real.
export default defineConfig({
  root,
  envDir: root,
  define: { 'process.env': {} },
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/libs/bookingPageContent', replacement: path.join(root, 'content.ts') },
      { find: 'next/navigation', replacement: path.join(root, 'navigation.ts') },
      { find: 'next/font/google', replacement: path.join(root, 'fonts.ts') },
      { find: 'next/image', replacement: path.join(root, 'image.tsx') },
      { find: 'next-intl', replacement: path.join(root, 'translations.ts') },
      { find: '@', replacement: path.join(repository, 'src') },
    ],
  },
  server: { host: '127.0.0.1', port: 3138, strictPort: true, fs: { allow: [repository] } },
});
