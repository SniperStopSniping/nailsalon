import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SalonPolicyForm } from './PolicyForm';

type TestSalonPolicy = {
  requireBeforePhotoToStart: 'off' | 'optional' | 'required';
  requireAfterPhotoToFinish: 'off' | 'optional' | 'required';
  requireAfterPhotoToPay: 'off' | 'optional' | 'required';
  autoPostEnabled: boolean;
  autoPostPlatforms: Array<'instagram' | 'facebook' | 'tiktok'>;
  autoPostIncludePrice: boolean;
  autoPostIncludeColor: boolean;
  autoPostIncludeBrand: boolean;
  autoPostAiCaptionEnabled: boolean;
};

const initialPolicy: TestSalonPolicy = {
  requireBeforePhotoToStart: 'off',
  requireAfterPhotoToFinish: 'off',
  requireAfterPhotoToPay: 'off',
  autoPostEnabled: false,
  autoPostPlatforms: [],
  autoPostIncludePrice: true,
  autoPostIncludeColor: false,
  autoPostIncludeBrand: true,
  autoPostAiCaptionEnabled: false,
};

const superAdminPolicy = {
  requireBeforePhotoToStart: null,
  requireAfterPhotoToFinish: null,
  requireAfterPhotoToPay: null,
  autoPostEnabled: null,
  autoPostAiCaptionEnabled: null,
};

describe('SalonPolicyForm section-owned saves', () => {
  it.each(['photos', 'all', 'social'] as const)('only saves photo rules from the %s entry point', async (section) => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(<SalonPolicyForm initialSalonPolicy={{ ...initialPolicy, autoPostEnabled: true, autoPostAiCaptionEnabled: true }} superAdminPolicy={superAdminPolicy} salonName="Synthetic Studio" onSave={onSave} section={section} />);

    expect(screen.queryByRole('button', { name: 'Enable Auto-Post' })).not.toBeInTheDocument();
    expect(screen.queryByText('AI Caption')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Before Photo to Start'), 'required');
    await user.click(screen.getByRole('button', { name: 'Save photo rules' }));

    expect(onSave).toHaveBeenCalledWith({ requireAfterPhotoToFinish: 'off', requireAfterPhotoToPay: 'off', requireBeforePhotoToStart: 'required' });
  });
});
