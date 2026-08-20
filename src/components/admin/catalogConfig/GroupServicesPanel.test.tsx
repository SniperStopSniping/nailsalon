import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceResponse } from '@/types/admin';

import { GroupServicesPanel } from './GroupServicesPanel';

function service(overrides: Partial<ServiceResponse> & { id: string; name: string }): ServiceResponse {
  return { price: 5000, durationMinutes: 45, isActive: true, ...overrides };
}

const flatServices: ServiceResponse[] = [
  service({ id: 'svc_1', name: 'Gel Manicure' }),
  service({ id: 'svc_2', name: 'Classic Pedicure' }),
];

const familyServices: ServiceResponse[] = [
  service({ id: 'svc_parent', name: 'Gel Manicure', variantKind: 'length' }),
  service({ id: 'svc_child', name: 'Gel Manicure — Long', parentServiceId: 'svc_parent', variantLabel: 'Long' }),
  service({ id: 'svc_solo', name: 'Classic Pedicure' }),
];

function renderPanel(services: ServiceResponse[], onRefresh = vi.fn()) {
  render(<GroupServicesPanel salonSlug="isla-nail-studio" services={services} onRefresh={onRefresh} />);
  return { onRefresh };
}

describe('GroupServicesPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('legacy simplicity: an all-flat salon shows every service under "Not grouped", nothing pre-selected or auto-created', () => {
    renderPanel(flatServices);

    expect(screen.getByText('Not grouped')).toBeInTheDocument();
    expect(screen.getByTestId('service-standalone-svc_1')).toBeInTheDocument();
    expect(screen.getByTestId('service-standalone-svc_2')).toBeInTheDocument();
    expect(screen.queryByText('Families')).not.toBeInTheDocument();
    // No raw ids in the rendered copy.
    expect(document.body.textContent ?? '').not.toMatch(/svc_1\b/);
  });

  it('renders an existing family with the parent, variant labels, and its axis — no raw ids', () => {
    renderPanel(familyServices);

    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Varies by length')).toBeInTheDocument();
    expect(screen.getByText('Long')).toBeInTheDocument();
    expect(screen.getByTestId('service-standalone-svc_solo')).toBeInTheDocument();
  });

  it('ALWAYS previews via /service-families/inspect before ever calling the commit endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        changes: [
          { field: 'parentServiceId', serviceId: 'svc_2', from: null, to: 'svc_1' },
          { field: 'variantLabel', serviceId: 'svc_2', from: null, to: 'Long' },
        ],
        warnings: [{ code: 'category_mismatch', message: 'Categories differ.' }],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel(flatServices);

    fireEvent.click(screen.getByTestId('service-family-open'));
    const dialog = screen.getByTestId('service-family-dialog');
    fireEvent.change(within(dialog).getByLabelText('Parent service'), { target: { value: 'svc_1' } });
    fireEvent.change(within(dialog).getByLabelText('Variant service'), { target: { value: 'svc_2' } });
    fireEvent.change(within(dialog).getByLabelText('Variant label'), { target: { value: 'Long' } });
    fireEvent.change(within(dialog).getByLabelText('What do these variants vary by?'), { target: { value: 'length' } });

    fireEvent.click(within(dialog).getByTestId('service-family-preview'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/salon/service-families/inspect');

    // The review step must resolve ids to names — never show a raw id.
    const review = await within(dialog).findByTestId('service-family-review');

    expect(review).toHaveTextContent(/Classic Pedicure becomes a variant of Gel Manicure\./);
    expect(review).not.toHaveTextContent(/svc_1\b/);
    expect(within(dialog).getByText('Categories differ.')).toBeInTheDocument();

    // Nothing has been committed yet — only inspect ran.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByTestId('service-family-commit'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1]![0]).toBe('/api/salon/service-families');
  });

  it('requires a variant label before it will even call inspect', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel(flatServices);

    fireEvent.click(screen.getByTestId('service-family-open'));
    const dialog = screen.getByTestId('service-family-dialog');
    fireEvent.change(within(dialog).getByLabelText('Parent service'), { target: { value: 'svc_1' } });
    fireEvent.change(within(dialog).getByLabelText('Variant service'), { target: { value: 'svc_2' } });

    fireEvent.click(within(dialog).getByTestId('service-family-preview'));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/label/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removing a variant from a family previews the detach before committing it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        changes: [{ field: 'parentServiceId', serviceId: 'svc_child', from: 'svc_parent', to: null }],
        warnings: [],
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel(familyServices);

    fireEvent.click(screen.getByTestId('service-family-detach-svc_child'));
    const dialog = screen.getByTestId('service-family-dialog');
    fireEvent.click(within(dialog).getByTestId('service-family-preview'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({ operation: 'detach', childServiceId: 'svc_child' });
  });
});
