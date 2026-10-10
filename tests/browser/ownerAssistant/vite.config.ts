import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { OWNER_ASSISTANT_DISCLOSURE } from '../../../src/libs/ownerAssistant/contracts';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');

export default defineConfig({
  root,
  cacheDir: path.join(os.tmpdir(), 'luster-owner-assistant-recovery-vite-cache'),
  plugins: [react(), {
    name: 'synthetic-owner-assistant-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/api/admin/owner-assistant/')) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/json');
        if (request.url.startsWith('/api/admin/owner-assistant/context')) {
          response.end(JSON.stringify({
            enabled: true,
            salonSlug: 'synthetic-assistant-salon',
            salonName: 'Synthetic Assistant Salon',
            ownerRef: 'synthetic-owner',
            model: { available: true },
            tools: ['find_destination'],
            suggestedQuestions: ['Where do I change my hours?'],
            disclosure: OWNER_ASSISTANT_DISCLOSURE,
          }));
        } else if (request.url === '/api/admin/owner-assistant/chat') {
          response.end(JSON.stringify({
            kind: 'answer',
            message: 'Open Hours & Availability to change your working hours.',
            checked: [{ tool: 'find_destination', label: 'where things live in Luster' }],
            links: [],
            followUps: [],
            needsClarification: false,
            conversation: 'synthetic-conversation',
            usage: { modelCalls: 1, toolCalls: 1 },
          }));
        } else {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'No synthetic endpoint' }));
        }
      });
    },
  }],
  resolve: { alias: {
    'next/navigation': path.join(repository, 'tests/browser/customerAssistant/navigation.ts'),
    '@': path.join(repository, 'src'),
  } },
  server: { host: '127.0.0.1', port: 3176, strictPort: true, fs: { allow: [repository] } },
});
