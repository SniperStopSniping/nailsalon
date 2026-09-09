import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LusterClientSms } from './LusterClientSms';

const fetchMock = vi.fn();
const sms = { manualAvailable: true, senderLabel: 'Luster messaging number', senderMode: 'shared_luster' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function renderComposer() {
  render(<LusterClientSms salonSlug="test-salon" salonName="Test Salon" clientId="client-test" composerOpen onClose={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(() => Promise.resolve(response({ data: { sms, history: [] } })));
});

describe('Luster SMS composer', () => {
  it('shows setup blockers and disables send when texting is unavailable', async () => {
    fetchMock.mockResolvedValue(response({ data: { sms: { ...sms, manualAvailable: false, detail: 'Texting is not set up yet.' }, history: [] } }));
    renderComposer();

    expect(await screen.findByText('Texting is not set up yet.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });

    expect(screen.getByRole('button', { name: 'Send text' })).toBeDisabled();
  });

  it('queues only one send for double clicks and shows queued rather than delivered', async () => {
    let resolveSend: (value: Response) => void = () => {};
    fetchMock.mockImplementation((_url, init) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => {
        resolveSend = resolve;
      })
      : Promise.resolve(response({ data: { sms, history: [] } })));
    renderComposer();
    await screen.findByText('Luster messaging number');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please call the salon about your appointment.' } });
    const send = screen.getByRole('button', { name: 'Send text' });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    resolveSend(response({ data: { sms, history: [] } }, 202));

    expect(await screen.findByText('Text queued. Delivery updates appear below.')).toBeVisible();
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
  });

  it('reuses the identical request id and body after an ambiguous network result', async () => {
    let attempt = 0;
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method === 'POST' && attempt++ === 0) {
        return Promise.reject(new Error('network'));
      }
      return Promise.resolve(response({ data: { sms, history: [] } }));
    });
    renderComposer();
    await screen.findByText('Luster messaging number');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please call about your visit.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry same request' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    const sends = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

    expect(sends[0]![1].body).toBe(sends[1]![1].body);

    await screen.findByText('Text queued. Delivery updates appear below.');
  });

  it('shows terminal delivery failures and allows only server-approved retry', async () => {
    const base = { id: 'ci-failed', eventType: 'manual_text', message: 'Appointment update', recipient: '•••• 0100', createdAt: '2026-09-08T12:00:00Z', updatedAt: '2026-09-08T12:00:00Z', scheduledFor: '2026-09-08T12:00:00Z' };
    fetchMock.mockResolvedValue(response({ data: { sms, history: [
      { ...base, status: 'failed', failureReason: 'The provider rejected this message.', canRetry: true },
      { ...base, id: 'ci-unknown', status: 'checking_delivery', canRetry: false },
    ] } }));
    renderComposer();

    expect(await screen.findByText('Failed')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Retry text' })).toHaveLength(1);
    expect(screen.getByText('Checking delivery')).toBeVisible();
  });
});
