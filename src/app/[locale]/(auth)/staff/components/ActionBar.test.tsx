import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the completion form and uses the real completion route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          services: [{ id: 'service_1', name: 'BIAB Short', category: 'nails', priceCents: 6500, durationMinutes: 75 }],
          addOns: [],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_1',
            status: 'completed',
          },
          showReviewPrompt: false,
        },
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();

    render(
      <ActionBar
        appointment={{
          id: 'appt_1',
          clientPhone: '+14165551234',
          status: 'in_progress',
          canvasState: 'working',
          technicianId: 'tech_1',
          clientName: 'Ava',
          startTime: '2026-03-20T10:00:00.000Z',
          endTime: '2026-03-20T11:15:00.000Z',
          totalPrice: 6500,
          services: [{ name: 'BIAB Short' }],
          photos: [{ id: 'photo_1', photoType: 'after', imageUrl: '/after.jpg', thumbnailUrl: null }],
        }}
        onOpenPhotos={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('staff-action-complete'));

    await screen.findByRole('heading', { name: /complete appointment/i });
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
    fireEvent.click(screen.getByTestId('staff-complete-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_1/complete', expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"performedServiceIds":["service_1"]'),
      }));
    });

    expect(onClose).toHaveBeenCalled();
  });
});
