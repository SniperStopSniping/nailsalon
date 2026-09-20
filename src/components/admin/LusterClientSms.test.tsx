import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LusterClientSms } from './LusterClientSms';

const fetchMock = vi.fn();
const sms = { manualAvailable: true, senderLabel: 'Luster messaging number', senderMode: 'shared_luster' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function renderComposer(overrides: Partial<React.ComponentProps<typeof LusterClientSms>> = {}) {
  return render(
    <LusterClientSms
      salonSlug="test-salon"
      salonName="Test Salon"
      clientId="client-test"
      recipientPhone="4165551234"
      composerOpen
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(() => Promise.resolve(response({ data: { sms, history: [] } })));
});

describe('Luster SMS composer', () => {
  it('can keep appointment SMS evidence collapsed without removing it', async () => {
    renderComposer({ composerOpen: false, historyInitiallyOpen: false });
    const summary = await screen.findByText('SMS history');

    expect(summary.closest('details')).not.toHaveAttribute('open');

    await waitFor(() => expect(screen.getByText('No Luster texts for this client yet.')).not.toBeVisible());
    fireEvent.click(summary);

    // Native details toggling is exercised in the mobile browser harness.
    expect(screen.getByText('No Luster texts for this client yet.')).toBeInTheDocument();
  });

  it.each([
    ['customer_disabled', 'Reminders disabled by customer'],
    ['opted_out', 'STOP / opted out. A new booking cannot restart appointment texts.'],
  ])('shows %s even when no SMS was queued', async (state, label) => {
    fetchMock.mockResolvedValue(response({ data: { sms, history: [], reminderPreference: { state } } }));
    renderComposer();

    expect(await screen.findByText(label!)).toBeVisible();
    expect(screen.queryByText('Send failed')).not.toBeInTheDocument();
  });

  it('shows setup blockers and disables send when texting is unavailable', async () => {
    fetchMock.mockResolvedValue(response({ data: { sms: { ...sms, manualAvailable: false, detail: 'Texting is not set up yet.' }, history: [] } }));
    renderComposer();

    expect(await screen.findByText('Texting is not set up yet.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });

    expect(screen.getByRole('button', { name: 'Send text' })).toBeDisabled();
  });

  it('queues only one send for double clicks and shows queued rather than delivered', async () => {
    let resolveSend: (value: Response) => void = () => {};
    const onSent = vi.fn();
    fetchMock.mockImplementation((_url, init) => init?.method === 'POST'
      ? new Promise<Response>((resolve) => {
        resolveSend = resolve;
      })
      : Promise.resolve(response({ data: { sms, history: [] } })));
    renderComposer({ onSent });
    await screen.findByText('Luster messaging number');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please call the salon about your appointment.' } });
    const send = screen.getByRole('button', { name: 'Send text' });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    resolveSend(response({ data: { sms, history: [] } }, 202));

    expect(await screen.findByText('Text queued. Delivery updates appear below.')).toBeVisible();
    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
    expect(onSent).toHaveBeenCalledWith('Please call the salon about your appointment.');
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

  it('marks an explicit Google review send without forwarding an incidental appointment', async () => {
    renderComposer({
      appointmentId: 'upcoming-appointment',
      purpose: 'google_review',
      initialDraft: 'Hi Ava, please leave a review: https://g.page/review',
    });
    await screen.findByText('Luster messaging number');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Owner-edited review invitation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    const send = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(send?.[1]?.body));

    expect(body).toMatchObject({
      salonSlug: 'test-salon',
      purpose: 'google_review',
      message: 'Owner-edited review invitation.',
    });
    expect(body).not.toHaveProperty('appointmentId');
  });

  it('previews the review-specific final body without the manual STOP footer', async () => {
    renderComposer({
      purpose: 'google_review',
      initialDraft: 'Thanks for visiting! https://g.page/review',
    });

    expect(await screen.findByTestId('sms-message-preview')).toHaveTextContent(
      'Test Salon via Luster: Thanks for visiting! https://g.page/review',
    );
    expect(screen.getByTestId('sms-message-preview')).not.toHaveTextContent('Reply STOP to opt out.');
    expect(screen.getByTestId('sms-segment-summary')).toHaveTextContent('1 SMS segment · 1 credit');
  });

  it('shows the manual message footer in the final customer-facing preview', async () => {
    renderComposer({ initialDraft: 'Please call about your appointment.' });

    expect(await screen.findByTestId('sms-message-preview')).toHaveTextContent(
      'Test Salon via Luster: Please call about your appointment. Reply STOP to opt out.',
    );
  });

  it('keeps ordinary message payloads unchanged', async () => {
    renderComposer({ appointmentId: 'upcoming-appointment' });
    await screen.findByText('Luster messaging number');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please call about your appointment.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send text' }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    const send = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(send?.[1]?.body));

    expect(body).toMatchObject({ salonSlug: 'test-salon', appointmentId: 'upcoming-appointment' });
    expect(body).not.toHaveProperty('purpose');
  });

  it('preserves an owner edit when the same review preset rerenders', async () => {
    const { rerender } = renderComposer({
      purpose: 'google_review',
      initialDraft: 'Hi Ava, please leave a review: https://g.page/review',
    });
    await screen.findByText('Luster messaging number');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Owner-edited review invitation.' } });

    rerender(
      <LusterClientSms
        salonSlug="test-salon"
        salonName="Test Salon"
        clientId="client-test"
        recipientPhone="4165551234"
        composerOpen
        composerTitle="Send Google review link"
        initialDraft="Hi Ava, please leave a review: https://g.page/review"
        purpose="google_review"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Message')).toHaveValue('Owner-edited review invitation.');
  });

  it('prefills a contextual draft and opens the phone composer without using Luster', async () => {
    const onOpenNativeUrl = vi.fn();
    const onPhoneDraftOpened = vi.fn();
    renderComposer({
      composerTitle: 'Send Google review link',
      initialDraft: 'Hi Ava, please review us: https://g.page/review',
      onOpenNativeUrl,
      onPhoneDraftOpened,
    });

    expect(await screen.findByRole('dialog', { name: 'Send Google review link' })).toBeVisible();
    expect(screen.getByLabelText('Message')).toHaveValue('Hi Ava, please review us: https://g.page/review');

    fireEvent.click(screen.getByRole('button', { name: 'Send from my phone · no Luster credits' }));

    expect(onPhoneDraftOpened).toHaveBeenCalledWith('Hi Ava, please review us: https://g.page/review');
    expect(onOpenNativeUrl).toHaveBeenCalledWith(expect.stringContaining('sms:4165551234'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows terminal delivery failures and allows only server-approved retry', async () => {
    const base = { id: 'ci-failed', eventType: 'manual_text', message: 'Appointment update', recipient: '•••• 0100', createdAt: '2026-09-08T12:00:00Z', updatedAt: '2026-09-08T12:00:00Z', scheduledFor: '2026-09-08T12:00:00Z' };
    fetchMock.mockResolvedValue(response({ data: { sms, history: [
      { ...base, status: 'failed', failureReason: 'The provider rejected this message.', canRetry: true },
      { ...base, id: 'ci-unknown', status: 'checking_delivery', canRetry: false },
    ] } }));
    renderComposer();

    expect(await screen.findByText('Send failed')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Retry text' })).toHaveLength(1);
    expect(screen.getByText('Checking delivery')).toBeVisible();
  });
});
