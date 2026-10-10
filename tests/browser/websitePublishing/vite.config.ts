import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');
export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-website-publishing-vite-cache'),
  plugins: [react(), { name: 'isolated-publish-fixture', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/api/')) {
        return next();
      }
      response.setHeader('Content-Type', 'application/json');
      if (request.url.startsWith('/api/admin/salon/publish')) {
        response.end(JSON.stringify({ data: { publicationStatus: 'published' } }));
      } else {
        response.end(JSON.stringify({ enabled: false }));
      }
    });
  } }],
  resolve: { alias: { 'next/navigation': path.join(repository, 'tests/browser/customerAssistant/navigation.ts'), '@': path.join(repository, 'src') } },
  server: { host: '127.0.0.1', port: 3187, strictPort: true, fs: { allow: [repository] } },
});
