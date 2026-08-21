import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FloatingActionBar } from './FloatingActionBar';

describe('FloatingActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('opens canonical checkout instead of bypassing deposit and balance review', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const onSuccess = vi.fn();
    const onOpenCheckout = vi.fn();

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
        onOpenCheckout={onOpenCheckout}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /review & complete/i }));

    await waitFor(() => {
      expect(onOpenCheckout).toHaveBeenCalledOnce();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('staff-floating-action')).not.toHaveClass('fixed');
  });
});
