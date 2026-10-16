import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoShowReviewRequest } from './NoShowReviewRequest';

afterEach(() => vi.unstubAllGlobals());

describe('private no-show review request', () => {
  it('uses only the private appointment capability and explains suspension', async () => {
    const fetch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    render(<NoShowReviewRequest token="isolated-private-token" />);
    fireEvent.click(screen.getByRole('button', { name: /Request review of/ }));

    expect(screen.getByRole('button', { name: 'Request review' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I attended this appointment.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request review' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/suspended during review/));

    expect(fetch).toHaveBeenCalledWith('/api/public/appointments/manage/isolated-private-token/no-show-review', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'I attended this appointment.' }) }));
  });
});
