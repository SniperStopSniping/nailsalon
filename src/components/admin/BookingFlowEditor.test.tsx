import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BookingFlowEditor } from './BookingFlowEditor';

describe('BookingFlowEditor', () => {
  it('keeps a failed debounced save visible and reports the pending draft to its host', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Unavailable'));
    const onStateChange = vi.fn();

    render(
      <BookingFlowEditor
        bookingFlow={['service', 'tech', 'time', 'confirm']}
        bookingFlowCustomizationEnabled
        onSave={onSave}
        onStateChange={onStateChange}
      />,
    );

    fireEvent.click(screen.getByTitle('Click to hide technician step'));
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ dirty: true, saving: false }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save booking flow');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(onStateChange).toHaveBeenLastCalledWith({ dirty: true, saving: false });
  });
});
