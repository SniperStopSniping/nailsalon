import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewRequestSettings } from './ReviewRequestSettings';

const fetchMock = vi.fn();
const legacySettings = {
  googleReviewUrl: 'https://g.page/salon/review',
  automaticEnabled: false,
  delayMinutes: 60,
  messageTemplate: 'Hi {{firstName}}! {{reviewLink}}',
  businessName: 'Isla Nail Studio',
};
const configuredSettings = {
  ...legacySettings,
  policy: { mode: 'scheduled_end', delayMinutes: 45, repeatCooldownDays: 90 },
  readiness: { status: 'configured', reasons: [] },
};
const namedSettings = { ...configuredSettings, messageTemplate: 'Hi {{firstName}} from {{businessName}}! {{reviewLink}}' };
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function body(call = 1) {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body));
}
function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: resolve! };
}

describe('ReviewRequestSettings', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders a legacy manual setting without silently activating automation', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: legacySettings }));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('https://g.page/salon/review');

    expect(screen.getByRole('radio', { name: /manual only/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save review settings' })).toBeDisabled();
    expect(screen.getByText('Review request readiness has not been verified. Save settings to check setup.')).toBeVisible();
  });

  it('shows the complete sample review body and its calculated credit cost', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: legacySettings }));
    render(<ReviewRequestSettings salonSlug="isla" />);

    const preview = await screen.findByTestId('sms-message-preview');

    expect(preview).toHaveTextContent('Sample customer message');
    expect(preview).toHaveTextContent('Isla Nail Studio: Hi Avery! https://g.page/salon/review');
    expect(preview).not.toHaveTextContent('via Luster');
    expect(preview).not.toHaveTextContent('Reply STOP to opt out.');
    expect(screen.getByTestId('sms-segment-summary')).toHaveTextContent('1 SMS segment · 1 credit');
  });

  it('restores the default with the salon name in the message', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: legacySettings }));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('Hi {{firstName}}! {{reviewLink}}');

    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));

    expect(screen.getByLabelText('Message')).toHaveValue('Thank you for visiting {{businessName}}! We\'d love your Google review: {{reviewLink}}');
    expect(screen.getByTestId('sms-message-preview')).toHaveTextContent('Thank you for visiting Isla Nail Studio! We\'d love your Google review: https://g.page/salon/review');
    expect(screen.getByTestId('sms-message-preview')).not.toHaveTextContent('via Luster');
  });

  it('preserves the legacy lifetime cooldown when a salon only changes its message', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: legacySettings })).mockResolvedValueOnce(response({ data: legacySettings }));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('Hi {{firstName}}! {{reviewLink}}');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Thanks {{firstName}} {{reviewLink}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(body()).toEqual(expect.objectContaining({ automationMode: 'manual', repeatCooldownDays: 'never' }));
  });

  it('uses the recommendation only as a draft and sends the new canonical payload', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: legacySettings })).mockResolvedValueOnce(response({ data: configuredSettings }));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByRole('button', { name: 'Use recommended automation' });
    fireEvent.click(screen.getByRole('button', { name: 'Use recommended automation' }));

    expect(screen.getByRole('radio', { name: /after the appointment ends/i })).toBeChecked();
    expect(screen.getByLabelText('Send after')).toHaveValue('60');
    expect(screen.getByRole('button', { name: 'Save review settings' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(body()).toEqual(expect.objectContaining({ automationMode: 'scheduled_end', delayMinutes: 60, repeatCooldownDays: 90 }));
    expect(body()).not.toHaveProperty('automaticEnabled');
  });

  it('preserves a valid custom persisted delay for an automatic legacy salon', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: { ...legacySettings, automaticEnabled: true, delayMinutes: 45 } }));
    render(<ReviewRequestSettings salonSlug="isla" />);

    expect(await screen.findByLabelText('Send after')).toHaveValue('45');
    expect(screen.getByRole('option', { name: 'Custom (45 minutes)' })).toBeVisible();
  });

  it('keeps uncommon cooldown choices in Advanced and includes the choice when saved', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: configuredSettings })).mockResolvedValueOnce(response({ data: { ...configuredSettings, policy: { ...configuredSettings.policy, repeatCooldownDays: 365 } } }));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByText('Ready to request Google reviews.');

    expect(screen.getByText('Advanced').closest('details')).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Repeat-review cooldown'), { target: { value: '365' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(body()).toEqual(expect.objectContaining({ repeatCooldownDays: 365 }));
  });

  it('keeps draft changes after a failed save and supports a failed load retry', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { message: 'Temporarily unavailable' } }, 503)).mockResolvedValueOnce(response({ data: configuredSettings })).mockResolvedValueOnce(response({ error: { message: 'Could not save' } }, 503));
    render(<ReviewRequestSettings salonSlug="isla" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByDisplayValue('https://g.page/salon/review');
    fireEvent.change(screen.getByLabelText('Google review link'), { target: { value: 'https://example.com/reviews' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByLabelText('Google review link')).toHaveValue('https://example.com/reviews');
    expect(screen.getByRole('button', { name: 'Save review settings' })).toBeEnabled();
  });

  it('ignores a stale salon response after the salon changes', async () => {
    const oldIsla = deferred<Response>();
    fetchMock.mockImplementationOnce(() => oldIsla.promise).mockResolvedValueOnce(response({ data: { ...namedSettings, businessName: 'Nova Nails' } }));
    const view = render(<ReviewRequestSettings salonSlug="isla" />);
    view.rerender(<ReviewRequestSettings salonSlug="nova" />);
    await screen.findByText(/Hi Avery from Nova Nails!/);
    await act(async () => {
      oldIsla.resolve(response({ data: { ...namedSettings, businessName: 'Old Isla' } }));
      await oldIsla.promise;
    });

    expect(screen.queryByText(/Hi Avery from Old Isla!/)).not.toBeInTheDocument();
  });

  it('does not retain an old salon draft when the next salon load fails', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: configuredSettings }));
    const view = render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('https://g.page/salon/review');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Old draft {{reviewLink}}' } });
    fetchMock.mockResolvedValueOnce(response({ error: { message: 'Nova unavailable' } }, 503));
    view.rerender(<ReviewRequestSettings salonSlug="nova" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Nova unavailable');
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save review settings' })).not.toBeInTheDocument();

    const freshIsla = deferred<Response>();
    fetchMock.mockImplementationOnce(() => freshIsla.promise);
    view.rerender(<ReviewRequestSettings salonSlug="isla" />);

    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();

    await act(async () => {
      freshIsla.resolve(response({ data: { ...namedSettings, businessName: 'Fresh Isla' } }));
      await freshIsla.promise;
    });

    expect(await screen.findByText(/Hi Avery from Fresh Isla!/)).toBeVisible();
  });

  it('cannot let a delayed save for one salon overwrite another salon editor', async () => {
    const savedIsla = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response({ data: configuredSettings })).mockImplementationOnce(() => savedIsla.promise).mockResolvedValueOnce(response({ data: { ...namedSettings, businessName: 'Nova Nails' } }));
    const view = render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('Hi {{firstName}}! {{reviewLink}}');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Isla draft {{reviewLink}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));
    view.rerender(<ReviewRequestSettings salonSlug="nova" />);
    await screen.findByText(/Hi Avery from Nova Nails!/);
    await act(async () => {
      savedIsla.resolve(response({ data: { ...namedSettings, businessName: 'Old Isla' } }));
      await savedIsla.promise;
    });

    expect(screen.queryByText(/Hi Avery from Old Isla!/)).not.toBeInTheDocument();

    expect(screen.getByLabelText('Message')).toHaveValue(namedSettings.messageTemplate);
  });

  it('blocks same-salon edits and duplicate saves while a save is in flight', async () => {
    const saved = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response({ data: configuredSettings })).mockImplementationOnce(() => saved.promise);
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByDisplayValue('Hi {{firstName}}! {{reviewLink}}');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Pending {{reviewLink}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save review settings' }));

    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);

    saved.resolve(response({ data: configuredSettings }));
    await screen.findByRole('button', { name: 'Saved' });
  });

  it('does not claim readiness after unsaved mode or link changes', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: configuredSettings }));
    render(<ReviewRequestSettings salonSlug="isla" />);
    await screen.findByText('Ready to request Google reviews.');
    fireEvent.click(screen.getByRole('radio', { name: /manual only/i }));

    expect(screen.getByText('Changes are not saved yet. Save settings to check review-request readiness.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Google review link'), { target: { value: '' } });

    expect(screen.getByText('Changes are not saved yet. Save settings to check review-request readiness.')).toBeVisible();
  });
});
