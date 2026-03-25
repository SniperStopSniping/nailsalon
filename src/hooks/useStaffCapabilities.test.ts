import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useStaffCapabilities', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('deduplicates concurrent capability fetches across multiple hook consumers', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { useStaffCapabilities } = await import('./useStaffCapabilities');

    const first = renderHook(() => useStaffCapabilities());
    const second = renderHook(() => useStaffCapabilities());

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({
      data: {
        modules: {
          scheduleOverrides: true,
          staffEarnings: false,
        },
        visibility: {
          clientPhone: true,
          clientEmail: false,
          clientFullName: true,
          appointmentPrice: true,
          clientHistory: false,
          clientNotes: true,
          otherTechAppointments: false,
        },
      },
    }), { status: 200 }));

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false);
      expect(second.result.current.loading).toBe(false);
    });

    expect(first.result.current.modules?.scheduleOverrides).toBe(true);
    expect(second.result.current.modules?.scheduleOverrides).toBe(true);
  });
});
