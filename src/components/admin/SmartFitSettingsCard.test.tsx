import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SmartFitSettingsCard } from './SmartFitSettingsCard';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

/**
 * Queue the three load responses (settings, services, technicians) matched by
 * URL so Promise.all ordering never matters.
 */
function mockLoad({
  smartFit = {},
  currency = 'CAD',
  services = [
    { id: 'svc_1', name: 'Gel Manicure' },
    { id: 'svc_2', name: 'Pedicure' },
  ],
  technicians = [
    { id: 'tech_1', name: 'Amy' },
    { id: 'tech_2', name: 'Lan' },
  ],
}: {
  smartFit?: unknown;
  currency?: string;
  services?: Array<{ id: string; name: string }>;
  technicians?: Array<{ id: string; name: string }>;
} = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/admin/salon/settings') && init?.method !== 'PATCH') {
      return jsonResponse({ smartFit, bookingConfig: { currency } });
    }
    if (url.includes('/api/salon/services')) {
      return jsonResponse({ data: { services } });
    }
    if (url.includes('/api/admin/technicians')) {
      return jsonResponse({ data: { technicians } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

function lastPatchBody(): any {
  const patchCall = fetchMock.mock.calls.findLast(
    call => (call[1] as RequestInit | undefined)?.method === 'PATCH',
  );

  expect(patchCall).toBeDefined();

  return JSON.parse(patchCall![1]!.body as string);
}

async function renderCard(onDirtyChange?: (dirty: boolean) => void) {
  render(<SmartFitSettingsCard salonSlug="salon-a" onDirtyChange={onDirtyChange} />);
  await waitFor(() => {
    expect(screen.getByTestId('smart-fit-enabled')).toBeInTheDocument();
  });
}

describe('SmartFitSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('renders safely disabled when no configuration exists', async () => {
    mockLoad({ smartFit: {} });
    await renderCard();

    const toggle = screen.getByTestId('smart-fit-enabled') as HTMLInputElement;

    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId('smart-fit-inactive-note')).toBeInTheDocument();
    // Defaults shown, nothing auto-enabled.
    expect((screen.getByTestId('smart-fit-value') as HTMLInputElement).value).toBe('10');
    expect((screen.getByTestId('smart-fit-max-gap') as HTMLInputElement).value).toBe('10');
    expect((screen.getByTestId('smart-fit-min-improvement') as HTMLInputElement).value).toBe('20');
  });

  it('loads an existing valid configuration, including fixed cents as dollars', async () => {
    mockLoad({
      smartFit: {
        enabled: true,
        discountType: 'fixed',
        value: 750,
        maxRemainingGapMinutes: 15,
        minImprovementMinutes: 45,
        eligibleServiceIds: ['svc_1'],
        eligibleTechnicianIds: ['tech_2'],
      },
    });
    await renderCard();

    expect(screen.getByTestId('smart-fit-enabled')).toBeChecked();
    expect((screen.getByTestId('smart-fit-discount-type') as HTMLSelectElement).value).toBe('fixed');
    expect((screen.getByTestId('smart-fit-value') as HTMLInputElement).value).toBe('7.50');
    expect((screen.getByTestId('smart-fit-max-gap') as HTMLInputElement).value).toBe('15');
    expect((screen.getByTestId('smart-fit-min-improvement') as HTMLInputElement).value).toBe('45');
    expect(screen.getByLabelText('Smart Fit eligible service: Gel Manicure')).toBeChecked();
    expect(screen.getByLabelText('Smart Fit eligible technician: Lan')).toBeChecked();
    expect(screen.queryByTestId('smart-fit-inactive-note')).not.toBeInTheDocument();
  });

  it('shows the percentage example computed for display only', async () => {
    mockLoad({ smartFit: { enabled: true, discountType: 'percent', value: 10 } });
    await renderCard();

    expect(screen.getByTestId('smart-fit-example')).toHaveTextContent(/\$65\.00/);
    expect(screen.getByTestId('smart-fit-example')).toHaveTextContent(/\$58\.50/);
  });

  it('saves the full smartFit subtree and reports truthful success', async () => {
    mockLoad({ smartFit: {} });
    await renderCard();

    fireEvent.click(screen.getByTestId('smart-fit-enabled'));
    fireEvent.click(screen.getByLabelText('Smart Fit eligible service: Gel Manicure'));
    fireEvent.click(screen.getByLabelText('Smart Fit eligible technician: Amy'));

    fetchMock.mockResolvedValueOnce(jsonResponse({ smartFit: { enabled: true } }));
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-saved')).toBeInTheDocument();
    });

    expect(lastPatchBody()).toEqual({
      smartFit: {
        enabled: true,
        discountType: 'percent',
        value: 10,
        maxRemainingGapMinutes: 10,
        minImprovementMinutes: 20,
        eligibleServiceIds: ['svc_1'],
        eligibleTechnicianIds: ['tech_1'],
      },
    });
  });

  it('converts a fixed dollar amount to cents on save', async () => {
    mockLoad({ smartFit: { enabled: true } });
    await renderCard();

    fireEvent.change(screen.getByTestId('smart-fit-discount-type'), {
      target: { value: 'fixed' },
    });
    fireEvent.change(screen.getByTestId('smart-fit-value'), {
      target: { value: '7.50' },
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-saved')).toBeInTheDocument();
    });

    expect(lastPatchBody().smartFit).toMatchObject({
      discountType: 'fixed',
      value: 750,
    });
  });

  it('blocks invalid percentages with an inline error and no request', async () => {
    mockLoad({ smartFit: { enabled: true } });
    await renderCard();

    for (const bad of ['0', '']) {
      fireEvent.change(screen.getByTestId('smart-fit-value'), { target: { value: bad } });
      fireEvent.click(screen.getByTestId('smart-fit-save'));

      await waitFor(() => {
        expect(screen.getByText(/whole percentage greater than 0/)).toBeInTheDocument();
      });
    }

    expect(
      fetchMock.mock.calls.some(call => (call[1] as RequestInit | undefined)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('rejects an over-limit percentage inline', async () => {
    mockLoad({ smartFit: { enabled: true } });
    await renderCard();

    fireEvent.change(screen.getByTestId('smart-fit-value'), { target: { value: '101' } });
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByText(/cannot exceed 100%/)).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.some(call => (call[1] as RequestInit | undefined)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('blocks invalid fixed amounts and out-of-bounds minutes, focusing the first invalid field', async () => {
    mockLoad({ smartFit: { enabled: true } });
    await renderCard();

    fireEvent.change(screen.getByTestId('smart-fit-discount-type'), {
      target: { value: 'fixed' },
    });
    fireEvent.change(screen.getByTestId('smart-fit-value'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('smart-fit-max-gap'), { target: { value: '61' } });
    fireEvent.change(screen.getByTestId('smart-fit-min-improvement'), { target: { value: '241' } });
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByText(/amount greater than 0/)).toBeInTheDocument();
    });

    expect(screen.getByText(/from 0 to 60/)).toBeInTheDocument();
    expect(screen.getByText(/from 0 to 240/)).toBeInTheDocument();
    expect(screen.getByTestId('smart-fit-value')).toHaveFocus();
    expect(
      fetchMock.mock.calls.some(call => (call[1] as RequestInit | undefined)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('select all and clear update the service selection; empty selection is explained as all-eligible', async () => {
    mockLoad({ smartFit: { enabled: true } });
    await renderCard();

    fireEvent.click(screen.getByTestId('smart-fit-services-select-all'));

    expect(screen.getByLabelText('Smart Fit eligible service: Gel Manicure')).toBeChecked();
    expect(screen.getByLabelText('Smart Fit eligible service: Pedicure')).toBeChecked();

    fireEvent.click(screen.getByTestId('smart-fit-services-clear'));

    expect(screen.getByLabelText('Smart Fit eligible service: Gel Manicure')).not.toBeChecked();
    // Empty-selection semantics match the parser: empty = all services eligible.
    expect(screen.getByText(/Leave every service unchecked to allow Smart Fit on all services/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fireEvent.click(screen.getByTestId('smart-fit-save'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-saved')).toBeInTheDocument();
    });

    expect(lastPatchBody().smartFit.eligibleServiceIds).toEqual([]);
  });

  it('technician select all / clear round-trips into the payload', async () => {
    mockLoad({ smartFit: { enabled: true } });
    await renderCard();

    fireEvent.click(screen.getByTestId('smart-fit-technicians-select-all'));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-saved')).toBeInTheDocument();
    });

    expect(lastPatchBody().smartFit.eligibleTechnicianIds).toEqual(['tech_1', 'tech_2']);
  });

  it('stale saved ids do not crash, are surfaced, and are preserved on save', async () => {
    mockLoad({
      smartFit: {
        enabled: true,
        eligibleServiceIds: ['svc_1', 'svc_archived', 'svc_archived'],
        eligibleTechnicianIds: ['tech_gone'],
      },
    });
    await renderCard();

    expect(screen.getByTestId('smart-fit-stale-services')).toHaveTextContent(/1/);
    expect(screen.getByTestId('smart-fit-stale-technicians')).toHaveTextContent(/1/);

    fireEvent.click(screen.getByLabelText('Smart Fit eligible service: Pedicure'));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-saved')).toBeInTheDocument();
    });

    // Stale ids ride along (deduped) — never silently pruned, which could flip
    // an emptied list into "all services eligible".
    expect(lastPatchBody().smartFit.eligibleServiceIds).toEqual(['svc_1', 'svc_archived', 'svc_2']);
    expect(lastPatchBody().smartFit.eligibleTechnicianIds).toEqual(['tech_gone']);
  });

  it('a failed save keeps the entered values and shows an error, never claiming success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLoad({ smartFit: {} });
    await renderCard();

    fireEvent.click(screen.getByTestId('smart-fit-enabled'));
    fireEvent.change(screen.getByTestId('smart-fit-value'), { target: { value: '25' } });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500));
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-save-error')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('smart-fit-saved')).not.toBeInTheDocument();
    expect((screen.getByTestId('smart-fit-value') as HTMLInputElement).value).toBe('25');
    expect(screen.getByTestId('smart-fit-enabled')).toBeChecked();
    // Still dirty — retry stays available.
    expect(screen.getByTestId('smart-fit-save')).toBeEnabled();
  });

  it('prevents duplicate submissions while saving', async () => {
    mockLoad({ smartFit: {} });
    await renderCard();

    fireEvent.click(screen.getByTestId('smart-fit-enabled'));

    let resolveSave: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve;
    }));

    fireEvent.click(screen.getByTestId('smart-fit-save'));
    fireEvent.click(screen.getByTestId('smart-fit-save'));
    fireEvent.click(screen.getByTestId('smart-fit-save'));

    resolveSave(jsonResponse({}));
    await waitFor(() => {
      expect(screen.getByTestId('smart-fit-saved')).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.filter(call => (call[1] as RequestInit | undefined)?.method === 'PATCH')
        .length,
    ).toBe(1);
  });

  it('reports dirty state to the parent for unsaved-changes warnings', async () => {
    mockLoad({ smartFit: {} });
    const onDirtyChange = vi.fn();
    await renderCard(onDirtyChange);

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(false);
    });

    fireEvent.click(screen.getByTestId('smart-fit-enabled'));

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});
