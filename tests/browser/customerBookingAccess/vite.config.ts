import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const repository = path.resolve(root, '../../..');
const fixture = path.join(root, 'server-fixture.ts');
export default defineConfig({
  root,
  envDir: root,
  cacheDir: path.join(os.tmpdir(), 'luster-customer-booking-access-cache'),
  plugins: [react()],
  resolve: { alias: {
    '@/libs/tenant': fixture,
    '@/libs/appointmentAccess': fixture,
    '@/libs/DB': fixture,
    '@/libs/queries': fixture,
    '@/libs/retentionSettings.server': fixture,
    '@/libs/bookingEmailFinancialSummary.server': fixture,
    'next/font/google': fixture,
    'server-only': path.join(root, 'server-only.ts'),
    'next/navigation': path.join(repository, 'tests/browser/appointmentWorkflow/navigation.ts'),
    '@': path.join(repository, 'src'),
  } },
  server: { host: '127.0.0.1', port: 3192, strictPort: true, fs: { allow: [repository] } },
});
