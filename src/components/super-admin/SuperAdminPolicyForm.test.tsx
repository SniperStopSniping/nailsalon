import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuperAdminPoliciesClient } from '@/app/[locale]/super-admin/policies/client';

import { SuperAdminPolicyForm } from './SuperAdminPolicyForm';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const policy = {
  requireBeforePhotoToStart: null,
  requireAfterPhotoToFinish: null,
  requireAfterPhotoToPay: null,
  autoPostEnabled: null,
  autoPostAiCaptionEnabled: null,
};
const labels = ['Before Photo to Start', 'After Photo to Finish', 'After Photo to Pay', 'Enable Auto-Post', 'AI Caption'];

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('platform policy accessibility', () => {
  it('names all five selects through their visible labels and preserves no-override defaults', () => {
    render(<SuperAdminPolicyForm initialPolicy={policy} onSave={vi.fn()} />);

    for (const label of labels) {
      const field = screen.getByRole('combobox', { name: label });

      expect(screen.getByLabelText(label, { exact: true })).toBe(field);
      expect(field).toHaveValue('');
      expect((field as HTMLSelectElement).labels?.[0]?.textContent?.trim()).toBe(label);
    }
  });

  it('keeps label ids distinct when two forms are rendered', () => {
    render(
      <>
        <SuperAdminPolicyForm initialPolicy={policy} onSave={vi.fn()} />
        <SuperAdminPolicyForm initialPolicy={policy} onSave={vi.fn()} />
      </>,
    );
    const fields = screen.getAllByRole('combobox');

    expect(new Set(fields.map(field => field.id)).size).toBe(10);

    for (const label of labels) {
      expect(screen.getAllByLabelText(label, { exact: true })).toHaveLength(2);
    }
  });

  it('preserves the five policy values submitted through the labelled controls', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<SuperAdminPolicyForm initialPolicy={policy} onSave={save} />);
    const values = ['required', 'optional', 'off', 'true', 'false'];
    for (const [index, label] of labels.entries()) {
      fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value: values[index] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save Global Overrides' }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ requireBeforePhotoToStart: 'required', requireAfterPhotoToFinish: 'optional', requireAfterPhotoToPay: 'off', autoPostEnabled: true, autoPostAiCaptionEnabled: false }));

    expect(await screen.findByRole('button', { name: 'Saved!' })).toBeEnabled();
  });

  it('retains an edited value and retry action after a simulated failed save', async () => {
    render(<SuperAdminPolicyForm initialPolicy={policy} onSave={vi.fn().mockRejectedValue(new Error('Synthetic save refusal'))} />);
    fireEvent.change(screen.getByLabelText('Before Photo to Start', { exact: true }), { target: { value: 'required' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Global Overrides' }));

    expect(await screen.findByText('Synthetic save refusal')).toBeInTheDocument();
    expect(screen.getByLabelText('Before Photo to Start', { exact: true })).toHaveValue('required');
    expect(screen.getByRole('button', { name: 'Save Global Overrides' })).toBeEnabled();
  });

  it.each(['en', 'fr'])('names Back and retains the %s platform destination without a write', (locale) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<SuperAdminPoliciesClient locale={locale} initialPolicy={policy} metaStatus={{ hasSystemUserToken: false, hasFacebookPageId: false, hasInstagramAccountId: false, graphVersion: 'v25.0' }} latestFailure={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to platform dashboard' }));

    expect(push).toHaveBeenCalledWith(`/${locale}/super-admin`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
