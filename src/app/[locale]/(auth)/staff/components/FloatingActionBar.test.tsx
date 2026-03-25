import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingActionBar } from './FloatingActionBar';

describe('FloatingActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uses the real completion route for the floating complete action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response(JSON.stringify({
        data: {
          appointment: {
            id: 'appt_1',
            status: 'completed',
          },
        },
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const onSuccess = vi.fn();

    render(
      <FloatingActionBar
        appointment={{
          id: 'appt_1',
          clientPhone: '+14165551234',
          status: 'in_progress',
          canvasState: 'working',
          technicianId: 'tech_1',
          clientName: 'Ava',
          services: [{ name: 'BIAB Short' }],
          totalPrice: 6500,
          startTime: '2026-03-20T10:00:00.000Z',
          endTime: '2026-03-20T11:15:00.000Z',
          photos: [{ id: 'photo_1', photoType: 'after', imageUrl: '/after.jpg', thumbnailUrl: null }],
        }}
        onOpenPhotos={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /complete/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/appointments/appt_1/complete', expect.objectContaining({
        method: 'PATCH',
      }));
    });

    expect(onSuccess).toHaveBeenCalled();
  });
});
