import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getAllByText('Add your business or salon name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add your name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Choose who you’re setting Luster up for.').length)
      .toBeGreaterThan(0);
    expect(onValidationFailure).toHaveBeenCalledWith([
      'businessName',
      'ownerName',
      'businessStructure',
    ]);

    await user.type(screen.getByLabelText('Business or salon name'), 'Isla Nail Studio');
    await user.type(screen.getByLabelText('Your name'), 'Daniela');
    await user.click(screen.getByRole('radio', { name: 'Solo nail tech' }));
    expect(screen.getByRole('group', { name: 'Who are you setting Luster up for?' }))
      .toBeVisible();
    expect(screen.getByRole('radio', { name: 'Team or multi-tech salon' })).toBeVisible();
    expect(screen.queryByRole('radio', { name: 'Home studio' })).not.toBeInTheDocument();
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
    expect(screen.getByText('You can enter @yourstudio or yourstudio.')).toBeVisible();
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
          previewTimestamp="2026-08-27T18:30:00.000Z"
        />
      );
    }

    render(<Harness />);
    await user.type(screen.getByLabelText('City or general service area'), 'Scarborough, Ontario');
    await user.click(screen.getByRole('button', { name: /Contact/ }));
    expect(screen.getByRole('button', { name: /Location/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Contact/ })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1 answer needs attention.');
    expect(screen.getAllByText(
      'Add at least one public contact method, or choose Booking only.',
    ).length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Clients can:' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const primaryNumber = screen.getByLabelText('Client contact number');
    await waitFor(() => expect(primaryNumber).toHaveFocus());
    expect(primaryNumber).toHaveAttribute('aria-invalid', 'true');
    const contactDescriptionId = primaryNumber.getAttribute('aria-describedby');
    expect(contactDescriptionId).toBeTruthy();
    expect(document.getElementById(contactDescriptionId ?? '')).toHaveTextContent(
      'Add at least one public contact method, or choose Booking only.',
    );
    await user.click(screen.getByRole('switch', { name: 'Clients should use Booking only' }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('keeps location type separate and enforces Directions privacy choices', async () => {
    const user = userEvent.setup();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <LocationContactScreen
          profile={profile}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onProfileChange={update}
          onSkipHours={vi.fn()}
          previewTimestamp="2026-08-27T18:30:00.000Z"
        />
      );
    }

    render(<Harness />);
    const preview = screen.getByRole('img', { name: /Location and contact visual preview/u });
    expect(screen.getByRole('group', { name: 'Where do you see clients?' })).toBeVisible();
    await user.type(screen.getByLabelText('City or general service area'), 'Scarborough, Ontario');
    await user.type(screen.getByLabelText('Exact address (optional)'), '123 Example Avenue');
    expect(within(preview).getByText('Scarborough, Ontario')).toBeVisible();
    expect(within(preview).getByText('Exact address shared after booking.')).toBeVisible();
    expect(within(preview).queryByText('Directions')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Show publicly' }));
    expect(within(preview).getByText('123 Example Avenue')).toBeVisible();
    expect(within(preview).getByText('Directions')).toBeVisible();
    expect(preview.querySelector('button, a')).toBeNull();

    await user.clear(screen.getByLabelText('Exact address (optional)'));
    expect(within(preview).queryByText('Directions')).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', {
      name: 'Allow directions to my general service area',
    }));
    expect(within(preview).getByText('Directions')).toBeVisible();

    await user.click(screen.getByRole('radio', { name: 'Do not show' }));
    expect(within(preview).queryByText('Directions')).not.toBeInTheDocument();
  });

  it('uses one client number for enabled uses and preserves a disclosed text number', async () => {
    const user = userEvent.setup();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <LocationContactScreen
          profile={profile}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onProfileChange={update}
          onSkipHours={vi.fn()}
          previewTimestamp="2026-08-27T18:30:00.000Z"
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Contact/ }));
    await user.type(screen.getByLabelText('Client contact number'), '416-555-0100');
    await user.click(screen.getByRole('switch', { name: 'Call this number' }));
    await user.click(screen.getByRole('switch', { name: 'Text this number' }));
    await user.click(screen.getByRole('radio', { name: 'Text' }));
    await user.click(screen.getByRole('switch', {
      name: 'Use a different number for text messages',
    }));
    await user.type(screen.getByLabelText('Text message number'), '647-555-0199');

    const preview = screen.getByRole('img', { name: /Location and contact visual preview/u });
    expect(within(preview).getByText('647-555-0199')).toBeVisible();
    expect(within(preview).getByText('Text')).toBeVisible();
    expect(preview.querySelector('button, a')).toBeNull();

    await user.click(screen.getByRole('switch', { name: 'Text this number' }));
    expect(screen.queryByRole('radio', { name: 'Text' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Call' })).toBeChecked();
    expect(screen.queryByLabelText('Text message number')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Clients should use Booking only' }));
    expect(within(preview).getByText('Booking is the best way to reach us')).toBeVisible();
    expect(within(preview).queryByText('416-555-0100')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Client contact number')).toHaveValue('416-555-0100');
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
          previewTimestamp="2026-08-27T18:30:00.000Z"
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /Hours/ }));
    const monday = screen.getByRole('group', { name: 'Monday' });
    const sunday = screen.getByRole('group', { name: 'Sunday' });
    const copyWeekdays = screen.getByRole('button', { name: 'Copy Monday to weekdays' });
    expect(copyWeekdays).toBeDisabled();
    expect(within(sunday).getByRole('checkbox', { name: 'Closed' })).not.toBeChecked();
    await user.click(within(sunday).getByRole('checkbox', { name: 'Closed' }));
    await user.clear(within(monday).getByLabelText('Monday opens'));
    await user.type(within(monday).getByLabelText('Monday opens'), '11:00');
    expect(copyWeekdays).toBeDisabled();
    await user.type(within(monday).getByLabelText('Monday closes'), '18:00');
    expect(copyWeekdays).toBeEnabled();
    await user.click(copyWeekdays);
    expect(screen.getByLabelText('Friday opens')).toHaveValue('11:00');
    expect(screen.getByLabelText('Friday closes')).toHaveValue('18:00');
    expect(within(sunday).getByRole('checkbox', { name: 'Closed' })).toBeChecked();
  });

  it('keeps hours optional and only shows a deterministic public status when configured and visible', async () => {
    const user = userEvent.setup();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <LocationContactScreen
          profile={profile}
          onBack={vi.fn()}
          onContinue={vi.fn()}
          onProfileChange={update}
          onSkipHours={vi.fn()}
          previewTimestamp="2026-08-27T18:30:00.000Z"
        />
      );
    }

    render(<Harness />);
    const preview = screen.getByRole('img', { name: /Location and contact visual preview/u });
    const hoursCard = screen.getByRole('button', { name: /Hours/ });
    expect(hoursCard).toHaveTextContent('Not set · Optional');
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();

    await user.click(hoursCard);
    await user.type(screen.getByLabelText('Thursday opens'), '10:00');
    expect(hoursCard).toHaveTextContent('Not set · Optional');
    expect(screen.getByRole('switch', { name: 'Show hours on my website' })).toBeDisabled();
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Thursday closes'), '18:00');
    expect(screen.getByRole('switch', { name: 'Show hours on my website' })).toBeEnabled();
    expect(within(preview).getByText('Open until 6:00 PM')).toBeVisible();

    await user.click(screen.getByRole('switch', { name: 'Show hours on my website' }));
    expect(hoursCard).toHaveTextContent('Not shown on your site');
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Skip hours for now' }));
    expect(hoursCard).toHaveTextContent('Not shown on your site');
    expect(hoursCard).not.toHaveTextContent('Complete');
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();
  });
});
