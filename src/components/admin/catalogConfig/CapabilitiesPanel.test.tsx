import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityResponse, TechnicianCapabilityResponse } from '@/types/admin';

import { CapabilitiesPanel } from './CapabilitiesPanel';
import type { TechnicianOption } from './shared';

const capabilities: CapabilityResponse[] = [
  { id: 'cap_1', slug: 'advanced-nail-art', name: 'Advanced nail art', description: 'Chrome, ombré, 3D.', isActive: true },
];

const technicians: TechnicianOption[] = [
  { id: 'tech_1', name: 'Amy Chen', isActive: true },
  { id: 'tech_2', name: 'Jordan Lee', isActive: true },
];

const assignments: TechnicianCapabilityResponse[] = [
  { id: 'tc_1', technicianId: 'tech_1', capabilityId: 'cap_1' },
];

function renderPanel(overrides: Partial<{
  capabilities: CapabilityResponse[];
  assignments: TechnicianCapabilityResponse[];
  onRefresh: () => void;
}> = {}) {
  const onRefresh = overrides.onRefresh ?? vi.fn();
  render(
    <CapabilitiesPanel
      salonSlug="isla-nail-studio"
      capabilities={overrides.capabilities ?? capabilities}
      assignments={overrides.assignments ?? assignments}
      technicians={technicians}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

describe('CapabilitiesPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('legacy simplicity: a salon with no skills defined shows an empty, non-blocking state', () => {
    renderPanel({ capabilities: [], assignments: [] });

    expect(screen.getByText(/No skills defined yet/)).toBeInTheDocument();
  });

  it('shows human-readable skill and technician names, never a raw capability/assignment id', () => {
    renderPanel();

    expect(screen.getByText('Advanced nail art')).toBeInTheDocument();
    expect(screen.getByText('Amy Chen')).toBeInTheDocument();

    const bodyText = document.body.textContent ?? '';

    expect(bodyText).not.toMatch(/cap_1\b/);
    expect(bodyText).not.toMatch(/tc_1\b/);
  });

  it('creates a skill with label-associated fields and blocks an empty name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { capability: { id: 'cap_2', slug: 'gel-x', name: 'Gel-X application', description: null, isActive: true } },
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel();

    fireEvent.click(screen.getByTestId('capability-create-open'));
    const dialog = screen.getByTestId('capability-form-dialog');

    fireEvent.click(within(dialog).getByTestId('capability-save'));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Skill name is required.');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Skill name'), { target: { value: 'Gel-X application' } });
    fireEvent.click(within(dialog).getByTestId('capability-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('double-submit protection on skill create sends exactly one request', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel();

    fireEvent.click(screen.getByTestId('capability-create-open'));
    const dialog = screen.getByTestId('capability-form-dialog');
    fireEvent.change(within(dialog).getByLabelText('Skill name'), { target: { value: 'Nail piercing' } });

    const saveButton = within(dialog).getByTestId('capability-save');
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({ data: { capability: capabilities[0] } }), { status: 201 }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('assigns an unassigned technician to a skill, excluding technicians already assigned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { assignment: { id: 'tc_2', technicianId: 'tech_2', capabilityId: 'cap_1' } },
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel();

    const select = screen.getByLabelText('Assign a technician to Advanced nail art');

    expect(within(select).queryByText('Amy Chen')).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'tech_2' } });
    fireEvent.click(screen.getByTestId('capability-assign-cap_1'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/salon/technician-capabilities');
    expect(JSON.parse(String(init.body))).toMatchObject({ technicianId: 'tech_2', capabilityId: 'cap_1' });

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('removing an assignment shows the server error inline when it fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found.' },
    }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Amy Chen from Advanced nail art' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Assignment not found.');
  });

  it('deleting a skill requires confirmation and surfaces a blocked-deletion message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'CAPABILITY_HAS_ASSIGNMENTS', message: 'This capability is still assigned to 1 technician. Unassign it first.' },
    }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByTestId('capability-delete-cap_1'));
    const confirmDialog = screen.getByTestId('confirm-dialog');
    fireEvent.click(within(confirmDialog).getByTestId('confirm-dialog-confirm'));

    expect(await within(confirmDialog).findByText(/still assigned to 1 technician/)).toBeInTheDocument();
  });
});
