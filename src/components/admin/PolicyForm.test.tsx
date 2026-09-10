import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SalonPolicyForm } from './PolicyForm';

const initialPolicy = {
  requireBeforePhotoToStart: 'off' as const,
  requireAfterPhotoToFinish: 'off' as const,
  requireAfterPhotoToPay: 'off' as const,
  autoPostEnabled: false,
  autoPostPlatforms: [] as Array<'instagram' | 'facebook' | 'tiktok'>,
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
  it('keeps photo and social changes when both open surfaces save', async () => {
    const user = userEvent.setup();
    const canonicalPolicy = { ...initialPolicy };
    const savePhotos = vi.fn(async (patch: Partial<typeof initialPolicy>) => {
      Object.assign(canonicalPolicy, patch);
    });
    const saveSocial = vi.fn(async (patch: Partial<typeof initialPolicy>) => {
      Object.assign(canonicalPolicy, patch);
    });

    render(
      <>
        <SalonPolicyForm
          initialSalonPolicy={initialPolicy}
          superAdminPolicy={superAdminPolicy}
          salonName="Luster"
          onSave={savePhotos}
          section="photos"
        />
        <SalonPolicyForm
          initialSalonPolicy={initialPolicy}
          superAdminPolicy={superAdminPolicy}
          salonName="Luster"
          onSave={saveSocial}
          section="social"
        />
      </>,
    );

    await user.selectOptions(screen.getByLabelText('Before Photo to Start'), 'required');
    await user.click(screen.getByRole('button', { name: 'Enable Auto-Post' }));
    await user.click(screen.getByRole('button', { name: 'Save photo rules' }));
    await user.click(screen.getByRole('button', { name: 'Save social posting' }));

    expect(savePhotos).toHaveBeenCalledWith({
      requireAfterPhotoToFinish: 'off',
      requireAfterPhotoToPay: 'off',
      requireBeforePhotoToStart: 'required',
    });
    expect(saveSocial).toHaveBeenCalledWith({
      autoPostAiCaptionEnabled: false,
      autoPostEnabled: true,
      autoPostIncludeBrand: true,
      autoPostIncludeColor: false,
      autoPostIncludePrice: true,
      autoPostPlatforms: [],
    });
    expect(canonicalPolicy.requireBeforePhotoToStart).toBe('required');
    expect(canonicalPolicy.autoPostEnabled).toBe(true);
  });
});
