import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionBar } from './ActionBar';

describe('ActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the real completion route when staff completes an appointment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        appointment: {
          id: 'appt_1',
          status: 'completed',
        },
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

    fireEvent.click(screen.getAllByRole('button', { name: /complete & close/i })[1]!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_1/complete', expect.objectContaining({
        method: 'PATCH',
      }));
    });

    expect(onClose).toHaveBeenCalled();
  });
});
