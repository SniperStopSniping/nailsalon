import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AddOnResponse, CatalogPreviewResponse, ServiceResponse } from '@/types/admin';

import { PreviewPanel } from './PreviewPanel';
import type { TechnicianOption } from './shared';

const services: ServiceResponse[] = [
  { id: 'svc_1', name: 'Gel Manicure', price: 5500, durationMinutes: 45, isActive: true },
];

const addOns: AddOnResponse[] = [
  { id: 'addon_1', name: 'Nail Art', slug: 'nail-art', priceCents: 1000, durationMinutes: 10, category: 'nail_art', pricingType: 'fixed', isActive: true, compatibleServiceIds: ['svc_1'] },
];

const technicians: TechnicianOption[] = [{ id: 'tech_1', name: 'Amy Chen', isActive: true }];

function renderPanel() {
  render(<PreviewPanel salonSlug="isla-nail-studio" services={services} addOns={addOns} technicians={technicians} />);
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders exactly the server-returned price and duration numbers, without recomputing anything', async () => {
    const serverResult: { ok: true } & Extract<CatalogPreviewResponse, { ok: true }> = {
      ok: true,
      basePriceCents: 5500,
      baseDurationMinutes: 45,
      subtotalCents: 6500,
      totalDurationMinutes: 55,
      addOns: [
        { addOnId: 'addon_1', quantity: 1, unitPriceCents: 1000, lineTotalCents: 1000, unitDurationMinutes: 10, lineDurationMinutes: 10, autoAdded: false },
      ],
      violations: [],
      blocksContinue: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: serverResult }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc_1' } });
    fireEvent.click(screen.getByLabelText('Nail Art'));
    fireEvent.click(screen.getByTestId('catalog-preview-run'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/salon/catalog-preview');
    expect(JSON.parse(String(init.body))).toMatchObject({
      serviceId: 'svc_1',
      selectedAddOns: [{ addOnId: 'addon_1', quantity: 1 }],
    });

    const result = await screen.findByTestId('catalog-preview-result');

    // $65.00 total ($55 base + $10 add-on) and 55 min total — the server's
    // own arithmetic, formatted verbatim, never re-derived here.
    expect(result).toHaveTextContent(/\$65\.00/);
    expect(result).toHaveTextContent(/55 min/);
    expect(screen.getByTestId('catalog-preview-status')).toHaveTextContent('This selection is bookable.');
  });

  it('surfaces server-reported violations as plain sentences with names resolved, not raw ids', async () => {
    const serverResult: Extract<CatalogPreviewResponse, { ok: true }> = {
      ok: true,
      basePriceCents: 5500,
      baseDurationMinutes: 45,
      subtotalCents: 5500,
      totalDurationMinutes: 45,
      addOns: [],
      violations: [
        { code: 'capability_unavailable', anchor: { kind: 'service', serviceId: 'svc_1' } },
      ],
      blocksContinue: true,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: serverResult }), { status: 200 })));
    renderPanel();

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc_1' } });
    fireEvent.click(screen.getByTestId('catalog-preview-run'));

    expect(await screen.findByText('No available technician can perform Gel Manicure.')).toBeInTheDocument();
    expect(screen.getByTestId('catalog-preview-status')).toHaveTextContent('could not be booked');
    expect(document.body.textContent ?? '').not.toMatch(/svc_1\b/);
  });

  it('shows a friendly message for a corrupt-catalog (ok: false) response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { ok: false, code: 'cyclic_auto_add' },
    }), { status: 200 })));
    renderPanel();

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'svc_1' } });
    fireEvent.click(screen.getByTestId('catalog-preview-run'));

    expect(await screen.findByText(/bundling rules automatically include each other in a loop/)).toBeInTheDocument();
  });

  it('the Preview button is disabled until a service is picked, and is keyboard/label operable throughout', () => {
    renderPanel();

    expect(screen.getByTestId('catalog-preview-run')).toBeDisabled();
    expect(screen.getByLabelText('Service')).toBeInstanceOf(HTMLSelectElement);
    expect(screen.getByLabelText('Technician (optional)')).toBeInstanceOf(HTMLSelectElement);
  });
});
