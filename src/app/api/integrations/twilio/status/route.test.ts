/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, selectLimit, updateSet, updateWhere, validateRequest } = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    limit: selectLimit,
  };
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  return {
    db: {
      select: vi.fn(() => selectQuery),
      update: vi.fn(() => ({ set: updateSet })),
    },
    selectLimit,
    updateSet,
    updateWhere,
    validateRequest: vi.fn(),
  };
});

vi.mock('twilio', () => ({ default: { validateRequest } }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/Env', () => ({ Env: { TWILIO_AUTH_TOKEN: 'platform-token' } }));

import { POST } from './route';

function callbackRequest(signature = 'valid') {
  return new Request('https://app.luster.com/api/integrations/twilio/status?deliveryId=delivery_1', {
    method: 'POST',
    headers: { 'x-twilio-signature': signature },
    body: new URLSearchParams({
      MessageSid: 'SM123',
      MessageStatus: 'undelivered',
      ErrorCode: '30008',
      ErrorMessage: 'Unknown error',
    }),
  });
}

describe('Twilio delivery status callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateRequest.mockReturnValue(true);
    selectLimit.mockResolvedValue([{ salonId: 'salon_1' }]);
  });

  it('rejects callbacks without a valid Twilio signature', async () => {
    validateRequest.mockReturnValue(false);

    const response = await POST(callbackRequest('invalid'));

    expect(response.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('records final provider state and retryability within the delivery salon', async () => {
    const response = await POST(callbackRequest());

    expect(response.status).toBe(204);
    expect(updateSet).toHaveBeenCalledWith({
      providerMessageId: 'SM123',
      status: 'undelivered',
      errorCode: '30008',
      errorMessage: 'Unknown error',
      retryable: true,
    });
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});
