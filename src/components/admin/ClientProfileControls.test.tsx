import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ClientProfileControlProfile,
  ClientProfileControls,
} from './ClientProfileControls';

const fetchMock = vi.fn();

const activeProfile: ClientProfileControlProfile = {
  id: 'client_primary',
  fullName: 'Ava Nguyen',
  firstName: 'Ava',
  lastName: 'Nguyen',
  phone: '4165551234',
  email: 'ava@example.com',
  birthday: '1992-04-12',
  notes: 'Primary note',
  preferredTechnicianId: 'tech_primary',
  preferredTechnicianName: 'Daniela',
  rebookIntervalDays: 21,
  updatedAt: '2026-07-24T12:00:00.000Z',
  archivedAt: null,
  mergedIntoClientId: null,
  canManageLifecycle: true,
  canPermanentlyDelete: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderControls(profile = activeProfile) {
  const callbacks = {
    onUpdated: vi.fn(),
    onViewClient: vi.fn(),
    onMerged: vi.fn(),
    onRemoved: vi.fn(),
  };
  const result = render(
    <ClientProfileControls
      salonSlug="isla"
      currency="CAD"
      profile={profile}
      {...callbacks}
    />,
  );
  return { ...result, ...callbacks };
}

describe('ClientProfileControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows active controls and restricts permanent deletion to eligible archived profiles', () => {
    const { rerender } = renderControls();

    expect(screen.getByRole('button', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive client' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();

    rerender(
      <ClientProfileControls
        salonSlug="isla"
        currency="CAD"
        profile={{
          ...activeProfile,
          archivedAt: '2026-07-24T13:00:00.000Z',
          canPermanentlyDelete: true,
        }}
        onUpdated={vi.fn()}
        onViewClient={vi.fn()}
        onMerged={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge duplicate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive client' })).not.toBeInTheDocument();
  });

  it('keeps ordinary editing available without exposing manager-only lifecycle actions', () => {
    renderControls({
      ...activeProfile,
      canManageLifecycle: false,
    });

    expect(screen.getByRole('button', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge duplicate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).not.toBeInTheDocument();
  });

  it('does not expose the duplicate-warning merge shortcut to non-managers', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      error: {
        code: 'POSSIBLE_DUPLICATE',
        message: 'Possible duplicate',
      },
      data: {
        possibleDuplicate: {
          id: 'client_duplicate',
          fullName: 'Existing Ava',
          phone: '4165559999',
          email: 'existing@example.com',
          updatedAt: '2026-07-24T11:00:00.000Z',
        },
      },
    }, 409));

    renderControls({
      ...activeProfile,
      canManageLifecycle: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '4165559999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('button', { name: 'View existing client' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Merge profiles' }))
      .not.toBeInTheDocument();
  });

  it('searches active and archived profiles when choosing a duplicate', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const archived = url.searchParams.get('scope') === 'archived';
      return Promise.resolve(jsonResponse({
        data: {
          clients: archived
            ? [{
                id: 'client_archived',
                fullName: 'Archived Ada',
                phone: '4165550111',
                email: 'ada@example.com',
                birthday: null,
                archivedAt: '2026-07-20T12:00:00.000Z',
                mergedIntoClientId: null,
                updatedAt: '2026-07-20T12:00:00.000Z',
              }]
            : [],
        },
      }));
    });

    renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Merge duplicate' }));
    fireEvent.change(screen.getByLabelText('Find the duplicate'), {
      target: { value: 'Ada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('button', { name: /Archived Ada/i }))
      .toBeInTheDocument();
    expect(screen.getByText('Archived profile')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([input]) => (
      new URL(String(input), 'http://localhost').searchParams.get('scope')
    ))).toEqual(expect.arrayContaining(['active', 'archived']));
  });

  it('normalizes edit contact fields and offers a safe merge after a duplicate response', async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/admin/clients/client_primary' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({
          error: {
            code: 'POSSIBLE_DUPLICATE',
            message: 'Possible duplicate',
            details: {
              existingClient: {
                id: 'client_duplicate',
                fullName: 'Ava N.',
                firstName: 'Ava',
                lastName: 'N.',
                phone: '4165559999',
                email: 'other@example.com',
                birthday: null,
                notes: 'Duplicate safety note',
                preferredTechnicianId: 'tech_duplicate',
                rebookIntervalDays: 30,
                updatedAt: '2026-07-24T11:00:00.000Z',
              },
            },
          },
        }, 409));
      }
      if (url === '/api/admin/clients/client_primary/merge/preview' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          data: {
            primary: {
              client: {
                ...activeProfile,
                adminFlags: null,
                isBlocked: false,
                blockedReason: null,
              },
              records: {
                upcomingAppointments: 0,
                completedAppointments: 1,
              },
            },
            duplicate: {
              client: {
                id: 'client_duplicate',
                fullName: 'Ava N.',
                firstName: 'Ava',
                lastName: 'N.',
                phone: '4165559999',
                email: 'other@example.com',
                birthday: null,
                updatedAt: '2026-07-24T11:00:00.000Z',
                tags: ['vip', 'gel'],
                nailPreferences: { shape: 'almond' },
                sensitivities: 'HEMA',
                adminFlags: {
                  isProblemClient: true,
                  flagReason: 'Repeated charge disputes',
                },
                isBlocked: true,
                blockedReason: 'Do not contact',
              },
              records: {
                upcomingAppointments: 1,
                completedAppointments: 2,
                paymentRecords: 1,
                completedOutstandingCents: 5000,
                notes: 3,
              },
            },
            conflicts: [
              {
                key: 'email',
                label: 'Email',
                primaryValue: 'ava@example.com',
                duplicateValue: 'other@example.com',
                defaultSelection: 'primary',
              },
            ],
          },
        }));
      }
      if (url === '/api/admin/clients/client_primary/merge' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({
          data: { primaryClientId: 'client_primary' },
        }));
      }
      return Promise.resolve(jsonResponse({ error: { message: 'Unexpected request' } }, 500));
    });

    const {
      onMerged,
      onRemoved,
      onUpdated,
      onViewClient,
      rerender,
    } = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Edit client' }));
    fireEvent.change(screen.getByLabelText('Phone number'), {
      target: { value: '+1 (416) 555-9999' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '  OTHER@EXAMPLE.COM ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText(/possible duplicate already uses/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'View existing client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge profiles' })).toBeInTheDocument();

    rerender(
      <ClientProfileControls
        salonSlug="isla"
        currency="CAD"
        profile={{ ...activeProfile }}
        onUpdated={onUpdated}
        onViewClient={onViewClient}
        onMerged={onMerged}
        onRemoved={onRemoved}
      />,
    );

    expect(screen.getByLabelText('Phone number')).toHaveValue('+1 (416) 555-9999');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value.trim())
      .toBe('OTHER@EXAMPLE.COM');

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');

    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      phone: '4165559999',
      email: 'other@example.com',
      expectedUpdatedAt: activeProfile.updatedAt,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Merge profiles' }));

    await waitFor(() => {
      expect(screen.getByText('Records that will be preserved')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Keep this profile').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Merge this duplicate').length).toBeGreaterThan(0);
    expect(screen.getByText('Upcoming Appointments')).toBeInTheDocument();
    expect(screen.getByText('Completed Appointments')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Do not contact')).toBeInTheDocument();
    expect(screen.getByText('Important flag')).toBeInTheDocument();
    expect(screen.getByText('Repeated charge disputes')).toBeInTheDocument();
    expect(screen.getByText('vip, gel')).toBeInTheDocument();
    expect(screen.getByText(/Shape: almond/)).toBeInTheDocument();
    expect(screen.getByText(/Sensitivities: HEMA/)).toBeInTheDocument();
    expect(screen.getByText('Duplicate safety note')).toBeInTheDocument();
    expect(screen.getByText('tech_duplicate')).toBeInTheDocument();
    expect(screen.getAllByText('30 days').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Review merge' }));

    expect(screen.getByRole('heading', { name: 'Confirm merge' })).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Confirm merge' });

    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));

    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onMerged).toHaveBeenCalledWith('client_primary');
    });
    const mergeCall = fetchMock.mock.calls.find(([, init]) => (
      init?.method === 'POST'
      && String(init.body).includes('"fieldSelections"')
    ));

    expect(JSON.parse(String(mergeCall?.[1]?.body))).toMatchObject({
      primaryClientId: 'client_primary',
      duplicateClientId: 'client_duplicate',
      expectedPrimaryUpdatedAt: activeProfile.updatedAt,
      expectedDuplicateUpdatedAt: '2026-07-24T11:00:00.000Z',
      fieldSelections: { email: 'primary' },
    });
  });
});
