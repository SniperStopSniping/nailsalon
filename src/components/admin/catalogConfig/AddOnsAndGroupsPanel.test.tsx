import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AddOnGroupResponse, AddOnResponse, ServiceResponse } from '@/types/admin';

import { AddOnsAndGroupsPanel } from './AddOnsAndGroupsPanel';

const services: ServiceResponse[] = [
  { id: 'svc_1', name: 'Gel Manicure', price: 5500, durationMinutes: 45, isActive: true },
];

const addOns: AddOnResponse[] = [
  {
    id: 'addon_1',
    name: 'Nail Art',
    slug: 'nail-art',
    priceCents: 1000,
    durationMinutes: 10,
    category: 'nail_art',
    pricingType: 'fixed',
    isActive: true,
    groupId: null,
    compatibleServiceIds: ['svc_1'],
  },
];

const addOnGroups: AddOnGroupResponse[] = [
  {
    id: 'grp_1',
    name: 'Nail Shape',
    slug: 'nail-shape',
    description: null,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    isActive: true,
    templateKey: null,
    memberAddOnIds: ['addon_2'],
  },
];

function renderPanel(overrides: Partial<{
  addOnGroups: AddOnGroupResponse[];
  addOns: AddOnResponse[];
  onRefresh: () => void;
}> = {}) {
  const onRefresh = overrides.onRefresh ?? vi.fn();
  render(
    <AddOnsAndGroupsPanel
      salonSlug="isla-nail-studio"
      services={services}
      addOns={overrides.addOns ?? addOns}
      addOnGroups={overrides.addOnGroups ?? addOnGroups}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

describe('AddOnsAndGroupsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders groups and add-ons in owner language, and never renders a raw id', () => {
    renderPanel();

    expect(screen.getByText('Nail Shape')).toBeInTheDocument();
    expect(screen.getByText('Choose one · Required')).toBeInTheDocument();
    expect(screen.getByText('Nail Art')).toBeInTheDocument();
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();

    // `minSelections`/`maxSelections` must never appear as UI copy.
    expect(screen.queryByText(/minSelections/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/maxSelections/i)).not.toBeInTheDocument();

    // No raw ids anywhere in the rendered text.
    const bodyText = document.body.textContent ?? '';

    expect(bodyText).not.toMatch(/grp_1\b/);
    expect(bodyText).not.toMatch(/addon_1\b/);
    expect(bodyText).not.toMatch(/svc_1\b/);
  });

  it('creates a group, mapping owner vocabulary onto minSelections/maxSelections, with validation and label association', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { group: { ...addOnGroups[0], id: 'grp_2' } } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel();

    fireEvent.click(screen.getByTestId('addon-group-create-open'));
    const dialog = screen.getByTestId('addon-group-form-dialog');

    // Validation: empty name blocks submit, no request sent.
    fireEvent.click(within(dialog).getByTestId('addon-group-save'));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Group name is required.');
    expect(fetchMock).not.toHaveBeenCalled();

    // Label association.
    const nameInput = within(dialog).getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Polish finish' } });
    fireEvent.click(within(dialog).getByText('Choose multiple'));
    fireEvent.click(within(dialog).getByText('Required'));
    const maxInput = within(dialog).getByLabelText('Maximum (optional)');
    fireEvent.change(maxInput, { target: { value: '3' } });

    fireEvent.click(within(dialog).getByTestId('addon-group-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({
      name: 'Polish finish',
      minSelections: 1,
      maxSelections: 3,
    });

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('guards against a double-submit on group create — rapid double-click sends exactly one request', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel();

    fireEvent.click(screen.getByTestId('addon-group-create-open'));
    const dialog = screen.getByTestId('addon-group-form-dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Finish' } });

    const saveButton = within(dialog).getByTestId('addon-group-save');
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ data: { group: addOnGroups[0] } }), { status: 201 }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('shows the server GROUP_HAS_MEMBERS message when deleting a group that still has members', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'GROUP_HAS_MEMBERS', message: 'This group still has 1 add-on in it. Move or unlink them before deleting the group.' },
    }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByTestId('addon-group-delete-grp_1'));
    const confirmDialog = screen.getByTestId('confirm-dialog');
    fireEvent.click(within(confirmDialog).getByTestId('confirm-dialog-confirm'));

    expect(await within(confirmDialog).findByText(/still has 1 add-on in it/)).toBeInTheDocument();
  });

  it('creates an add-on with the picked group and compatible services', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { addOn: { ...addOns[0], id: 'addon_9' } } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel();

    fireEvent.click(screen.getByTestId('addon-create-open'));
    const dialog = screen.getByTestId('addon-create-dialog');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Chrome finish' } });
    fireEvent.change(within(dialog).getByLabelText('Price'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Duration (min)'), { target: { value: '10' } });
    fireEvent.change(within(dialog).getByLabelText('Add-on group (optional)'), { target: { value: 'grp_1' } });

    fireEvent.click(within(dialog).getByTestId('addon-create-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/salon/add-ons');

    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({ name: 'Chrome finish', priceCents: 500, durationMinutes: 10, groupId: 'grp_1' });

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('disables Save until the group actually changes, then PATCHes the add-on with its existing fields plus the new group', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { addOn: { ...addOns[0], groupId: 'grp_1' } } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByTestId('catalog-addon-change-group-addon_1'));
    const dialog = screen.getByTestId('addon-group-assign-dialog');
    const saveButton = within(dialog).getByTestId('addon-group-assign-save');

    expect(saveButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Add-on group'), { target: { value: 'grp_1' } });

    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/salon/add-ons/addon_1');

    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({ name: 'Nail Art', priceCents: 1000, durationMinutes: 10, groupId: 'grp_1' });
  });
});
