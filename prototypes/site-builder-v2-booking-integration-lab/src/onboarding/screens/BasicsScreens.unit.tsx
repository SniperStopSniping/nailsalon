import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import type { BusinessProfileDraft } from '../model/types';
import {
  BusinessScreen,
  LocationContactScreen,
  PhotoSocialScreen,
} from './BasicsScreens';

function useProfileHarness() {
  const [profile, setProfile] = useState(createDefaultBusinessProfile);
  return {
    profile,
    update: (patch: Partial<BusinessProfileDraft>) => {
      setProfile((current) => ({ ...current, ...patch }));
    },
  };
}

describe('BusinessScreen', () => {
  it('shows associated inline errors, then continues with shared profile values', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onValidationFailure = vi.fn();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <BusinessScreen
          profile={profile}
          onBack={vi.fn()}
          onContinue={onContinue}
          onProfileChange={update}
          onValidationFailure={onValidationFailure}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Add your business or salon name.')).toBeVisible();
    expect(screen.getByText('Add your name.')).toBeVisible();
    expect(screen.getByText('Choose the business type that fits best.')).toBeVisible();
    expect(onValidationFailure).toHaveBeenCalledWith([
      'businessName',
      'ownerName',
      'businessType',
    ]);

    await user.type(screen.getByLabelText('Business or salon name'), 'Isla Nail Studio');
    await user.type(screen.getByLabelText('Your name'), 'Daniela');
    await user.click(screen.getByRole('radio', { name: 'Solo nail tech' }));
    expect(screen.getByRole('complementary', { name: 'Business information preview' }))
      .toHaveTextContent('Isla Nail StudioDanielaSolo nail tech');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(/website url/i)).not.toBeInTheDocument();
  });
});
describe('PhotoSocialScreen', () => {
  it('uses a resilient initials preview and exposes real file controls', async () => {
    const user = userEvent.setup();
    const onProfilePhotoSelected = vi.fn();
    const onLogoSelected = vi.fn();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <PhotoSocialScreen
          profile={{ ...profile, businessName: 'Isla Nail Studio', ownerName: 'Daniela' }}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onLogoSelected={onLogoSelected}
          onProfileChange={update}
          onProfilePhotoSelected={onProfilePhotoSelected}
          onSkipPhoto={vi.fn()}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByLabelText('Profile photo placeholder')).toHaveTextContent('D');
    const photo = new File(['portrait'], 'daniela.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Profile photo (optional)'), photo);
    expect(onProfilePhotoSelected).toHaveBeenCalledWith(photo);
    await user.type(screen.getByLabelText('Instagram handle (optional)'), '@islanail.studio');
    expect(screen.getByRole('complementary', { name: 'Profile preview' }))
      .toHaveTextContent('@islanail.studio');
    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument();
  });
});

describe('LocationContactScreen', () => {
  it('keeps one mobile card open and validates contact-or-Booking choice', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <LocationContactScreen
          profile={profile}
          onBack={vi.fn()}
          onContinue={onContinue}
          onProfileChange={update}
          onSkipHours={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await user.type(screen.getByLabelText('City or general service area'), 'Scarborough, Ontario');
    await user.click(screen.getByRole('button', { name: /Contact/ }));
    expect(screen.getByRole('button', { name: /Location/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Contact/ })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one public contact method');
    await user.click(screen.getByRole('switch', { name: 'Clients should use Booking only' }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('copies Monday hours only to weekdays and keeps native closed controls', async () => {
    const user = userEvent.setup();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <LocationContactScreen
          profile={{
            ...profile,
            bookingOnlyContact: true,
            location: { ...profile.location, cityOrArea: 'Scarborough' },
          }}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onProfileChange={update}
          onSkipHours={vi.fn()}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Hours/ }));
    const monday = screen.getByRole('group', { name: 'Monday' });
    const sunday = screen.getByRole('group', { name: 'Sunday' });
    expect(within(sunday).getByRole('checkbox', { name: 'Closed' })).toBeChecked();
    await user.clear(within(monday).getByLabelText('Monday opens'));
    await user.type(within(monday).getByLabelText('Monday opens'), '11:00');
    await user.click(screen.getByRole('button', { name: 'Copy Monday to weekdays' }));
    expect(screen.getByLabelText('Friday opens')).toHaveValue('11:00');
    expect(within(sunday).getByRole('checkbox', { name: 'Closed' })).toBeChecked();
  });
});
