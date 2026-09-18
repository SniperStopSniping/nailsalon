import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scrubSentryEvent } from '@/libs/sentry/runtime';

import { customerChatRequestSchema } from './contracts';
import { customerInterpretationSchema } from './interpretation';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name))
    : /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path.join(directory, entry.name)] : []);
}

describe('customer assistant privilege and privacy guards', () => {
  it('cannot import owner tools, private actions or any appointment/payment write route', () => {
    const files = ['src/libs/customerAssistant', 'src/components/customerAssistant', 'src/app/api/public/customer-assistant'].flatMap(sourceFiles);
    const forbidden = /(?:from\s+|import\s*\()['"](?:@\/libs\/(?:ownerAssistant|adminAuth|staffAuth|SMS|deposits)|@\/app\/api\/(?:admin|appointments|billing))/;

    expect(forbidden.test('import { write } from \'@/libs/ownerAssistant/tools\';')).toBe(true);

    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }
  });

  it('rejects model-provided confirmation/prices and request-provided tenant/contact/role', () => {
    expect(customerInterpretationSchema.safeParse({ action: 'propose', serviceId: 'a', addOns: [], question: 'details', optionIds: [], price: 1, confirmed: true }).success).toBe(false);
    expect(customerChatRequestSchema.safeParse({ conversation: 'signed', message: 'hello', locale: 'en', salonId: 'other', role: 'owner', phone: '+15551234567' }).success).toBe(false);
  });

  it('scrubs customer words and capabilities before Sentry while preserving other routes', () => {
    const request = { url: 'https://app.test/api/public/customer-assistant/isla-nail-studio/chat?conversation=CAPABILITY', data: 'CUSTOMER_WORDS', cookies: 'COOKIE', headers: { Authorization: 'BEARER' } };
    const event = scrubSentryEvent({ request });

    expect(JSON.stringify(event)).not.toMatch(/CAPABILITY|CUSTOMER_WORDS|COOKIE|BEARER/);
    expect(scrubSentryEvent({ request: { url: 'https://app.test/api/health', data: 'keep' } }).request.data).toBe('keep');
  });
});
