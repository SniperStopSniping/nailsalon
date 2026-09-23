import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { buildVoiceSession } = await import('./live.server');

describe('voice live session boundaries', () => {
  it('makes browser sessions receive-only and disables provider storage', () => {
    const session = buildVoiceSession('Synthetic Isla', { greeting: '', voice: 'marin', language: 'auto', bookingEnabled: true }, true);

    expect(session).toMatchObject({ store: false, delegation: { type: 'client' }, client: { data_channel: { allowed_client_events: [] } } });
  });
});
