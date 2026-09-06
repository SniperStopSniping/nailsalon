import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AddOnCreateDialog } from './AddOnCreateDialog';

const services = [
  { id: 'svc_biab', name: 'BIAB Short', isActive: true },
  { id: 'svc_pedi', name: 'Spa Pedicure', isActive: false },
];

function lastPost(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(
    ([url, init]) => url === '/api/salon/add-ons' && (init as RequestInit)?.method === 'POST',
  );
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
}

describe('AddOnCreateDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { addOn: { id: 'addon_new', name: 'AUDIT-0905 Add-on' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an add-on with its price, duration and per-service eligibility', async () => {
    const onCreated = vi.fn();
    render(
      <AddOnCreateDialog
        isOpen
        salonSlug="nail-salon-no5"
        services={services}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByTestId('addon-create-name'), {
      target: { value: '  AUDIT-0905 Add-on  ' },
    });
    fireEvent.change(screen.getByTestId('addon-create-category'), { target: { value: 'repair' } });
    fireEvent.change(screen.getByTestId('addon-create-price'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('addon-create-duration'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('addon-create-description'), {
      target: { value: 'One line\n\nAnother line' },
    });
    fireEvent.click(screen.getByTestId('addon-create-service-svc_biab'));
    fireEvent.click(screen.getByTestId('addon-create-submit'));

    await waitFor(() => {
      expect(lastPost(fetchMock)).toBeTruthy();
    });

    expect(lastPost(fetchMock)).toEqual({
      salonSlug: 'nail-salon-no5',
      name: 'AUDIT-0905 Add-on',
      category: 'repair',
      descriptionItems: ['One line', 'Another line'],
      priceCents: 1000,
      priceDisplayText: null,
      durationMinutes: 10,
      isActive: true,
      serviceIds: ['svc_biab'],
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({ id: 'addon_new', name: 'AUDIT-0905 Add-on' });
    });
  });

  it('refuses an empty name and an unusable price before touching the network', () => {
    render(
      <AddOnCreateDialog
        isOpen
        salonSlug="nail-salon-no5"
        services={services}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('addon-create-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent('Add-on name is required.');

    fireEvent.change(screen.getByTestId('addon-create-name'), { target: { value: 'Chrome' } });
    fireEvent.click(screen.getByTestId('addon-create-submit'));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid price.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a refused create where the owner acted, and keeps their input', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'One or more selected services do not belong to this salon.' } }),
    });

    render(
      <AddOnCreateDialog
        isOpen
        salonSlug="nail-salon-no5"
        services={services}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId('addon-create-name'), { target: { value: 'Chrome' } });
    fireEvent.change(screen.getByTestId('addon-create-price'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('addon-create-duration'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('addon-create-submit'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'One or more selected services do not belong to this salon.',
    );
    expect(screen.getByTestId('addon-create-name')).toHaveValue('Chrome');
    expect(screen.getByTestId('addon-create-submit')).toBeEnabled();
  });

  it('says how to proceed when the salon has no services to attach to yet', () => {
    render(
      <AddOnCreateDialog
        isOpen
        salonSlug="nail-salon-no5"
        services={[]}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );

    expect(screen.getByTestId('addon-create-compatibility')).toHaveTextContent(
      'Add a service first, then choose where this add-on appears.',
    );
  });
});
