import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RebookingPromptSettings } from './RebookingPromptSettings';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => fetchMock.mockReset());

describe('RebookingPromptSettings', () => {
  it('loads missing-safe off state and only saves a deliberate toggle', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: { settings: { enabled: false } } }))
      .mockResolvedValueOnce(response({ data: { settings: { enabled: true, intervalWeeks: 3, message: 'Secure your next spot now.' } } }));
    render(<RebookingPromptSettings salonSlug="isla" />);

    const toggle = await screen.findByRole('switch', { name: 'Turn on Rebooking Prompt' });

    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Rebooking Prompt' })).toBeDisabled();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save Rebooking Prompt' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/rebooking-prompt?salonSlug=isla', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, intervalWeeks: 3, message: 'Secure your next spot now.' }),
    }));
    expect(await screen.findByRole('status')).toHaveTextContent('Rebooking Prompt saved.');
  });

  it('retains an owner change after a failed save', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: { settings: { enabled: false } } }))
      .mockResolvedValueOnce(response({ error: { message: 'Temporarily unavailable' } }, 503));
    render(<RebookingPromptSettings salonSlug="isla" />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Turn on Rebooking Prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Rebooking Prompt' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable');
    expect(screen.getByRole('switch', { name: 'Turn on Rebooking Prompt' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Rebooking Prompt' })).toBeEnabled();
  });

  it('edits the confirmation-page recommendation and message', async () => {
    fetchMock.mockResolvedValueOnce(response({ data: { settings: { enabled: true } } }))
      .mockResolvedValueOnce(response({ data: { settings: { enabled: true, intervalWeeks: 4, message: 'Reserve your preferred time.' } } }));
    render(<RebookingPromptSettings salonSlug="isla" />);

    const interval = await screen.findByLabelText('Recommended visit interval');
    fireEvent.change(interval, { target: { value: '4', valueAsNumber: 4 } });
    fireEvent.change(screen.getByLabelText('Encouragement message'), { target: { value: 'Reserve your preferred time.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Rebooking Prompt' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/rebooking-prompt?salonSlug=isla', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ enabled: true, intervalWeeks: 4, message: 'Reserve your preferred time.' }),
    }));
    expect(screen.getByText('We recommend every 4 weeks.')).toBeInTheDocument();
  });
});
