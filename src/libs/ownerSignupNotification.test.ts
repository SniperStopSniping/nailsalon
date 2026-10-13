import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationOutboxJob } from '@/models/Schema';

vi.mock('server-only', () => ({}));
const send = vi.hoisted(() => vi.fn());
const runtime = vi.hoisted(() => ({ environment: 'production' }));
vi.mock('@/libs/email', () => ({ sendTransactionalEmailDetailed: send }));
vi.mock('@/libs/environmentIsolation', () => ({ resolveRuntimeEnvironment: () => runtime.environment }));

const { deliverOwnerSignupNotification } = await import('./ownerSignupNotification');

const job = (): IntegrationOutboxJob => ({
  id: 'io_signup_test',
  salonId: 'salon_signup',
  appointmentId: null,
  provider: 'email',
  operation: 'owner_signup_notification',
  dedupeKey: 'owner-signup:user_test',
  payload: { salonId: 'salon_signup', salonSlug: 'test-studio', salonName: '<New Studio>', ownerName: 'Test Owner', ownerEmail: 'owner@example.com' },
  status: 'processing',
  attempts: 1,
  availableAt: new Date(),
  processedAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('owner signup email', () => {
  beforeEach(() => {
    runtime.environment = 'production';
    send.mockReset().mockResolvedValue({ ok: true, errorCode: null, providerMessageId: 'email_signup' });
  });

  it.each(['preview', 'development', 'ci', 'test', 'unknown'])('does not email support from %s', async (environment) => {
    runtime.environment = environment;

    expect(await deliverOwnerSignupNotification(job())).toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the authenticated owner details only to support with escaped HTML', async () => {
    expect(await deliverOwnerSignupNotification(job())).toBe('sent');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'support@lustergel.app',
      subject: 'New Luster salon signup',
      text: expect.stringContaining('Email: owner@example.com'),
      html: expect.stringContaining('&lt;New Studio&gt;'),
    }), expect.objectContaining({ idempotencyKey: 'luster-owner-signup/io_signup_test' }));
    expect(send.mock.calls[0]![0].html).not.toContain('<New Studio>');
  });

  it('uses the same provider key after a transient failure', async () => {
    const notification = job();
    send.mockResolvedValueOnce({ ok: false, errorCode: 'RESEND_TIMEOUT' });

    await expect(deliverOwnerSignupNotification(notification)).rejects.toThrow('RESEND_TIMEOUT');
    expect(await deliverOwnerSignupNotification(notification)).toBe('sent');
    expect(send.mock.calls.map(call => call[1].idempotencyKey)).toEqual([
      'luster-owner-signup/io_signup_test',
      'luster-owner-signup/io_signup_test',
    ]);
  });

  it('stops before the provider deduplication window expires', async () => {
    const notification = job();

    expect(await deliverOwnerSignupNotification(notification, { now: new Date(notification.createdAt.getTime() + 23 * 60 * 60 * 1000) })).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a different salon or a payload-supplied recipient', async () => {
    const notification = job();

    await expect(deliverOwnerSignupNotification({ ...notification, salonId: 'other_salon' })).rejects.toThrow('SIGNUP_NOTIFICATION_SCOPE_MISMATCH');
    await expect(deliverOwnerSignupNotification({ ...notification, payload: { ...notification.payload, to: 'elsewhere@example.com' } })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
