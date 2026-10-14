import { describe, expect, it } from 'vitest';

import { generateCaption } from './caption';
import type { PostPayload } from './poster';

describe('retained basic caption template', () => {
  it('accepts historical AI flags without generating unsupported details', async () => {
    const payload = { aiCaptionEnabled: true, includePrice: true, includeBrand: true, includeColor: true } as PostPayload;
    const caption = await generateCaption(payload, 'Synthetic Studio');

    expect(caption).toContain('Book your next appointment at Synthetic Studio.');
    expect(caption).not.toMatch(/\$|\bAI\b|\bcolour\b|\bcolor\b|\bbrand\b/i);
    expect(await generateCaption({ ...payload, aiCaptionEnabled: false }, 'Synthetic Studio')).toBe(caption);
  });
});
