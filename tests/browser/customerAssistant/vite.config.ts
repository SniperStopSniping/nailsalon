import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-customer-assistant-vite-cache'),
  plugins: [react()],
  // Next replaces this public debug flag in the real client bundle.
  define: { 'process.env.NEXT_PUBLIC_THEME_DEBUG': JSON.stringify('false') },
  resolve: { alias: [
    { find: 'next/navigation', replacement: path.join(root, 'navigation.ts') },
    { find: 'next/font/google', replacement: path.resolve(repository, 'tests/browser/booking-theme/fonts.ts') },
    { find: 'next/image', replacement: path.resolve(repository, 'tests/browser/booking-theme/image.tsx') },
    { find: 'next-intl', replacement: path.resolve(repository, 'tests/browser/booking-theme/translations.ts') },
    { find: '@/libs/bookingPageContent', replacement: path.resolve(repository, 'tests/browser/booking-theme/content.ts') },
    { find: '@', replacement: path.join(repository, 'src') },
  ] },
  server: { host: '127.0.0.1', port: 3130, strictPort: true, fs: { allow: [repository] } },
});
