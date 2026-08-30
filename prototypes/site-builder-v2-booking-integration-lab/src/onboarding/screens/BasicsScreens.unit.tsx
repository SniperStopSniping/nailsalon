import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import type { BusinessProfileDraft, StarterId } from '../model/types';
import {
  BrandBasicsScreen,
  LocationContactScreen,
} from './BasicsScreens';

vi.mock('../../custom-design/integration/CustomDesignAssetProvider', () => ({
  useCustomDesignAssetMap: () => new Map(),
}));

function useProfileHarness() {
  const [profile, setProfile] = useState(createDefaultBusinessProfile);
  return {
    profile,
    update: (patch: Partial<BusinessProfileDraft>) => {
      setProfile((current) => ({ ...current, ...patch }));
    },
  };
}

type BrandBasicsHandlers = Partial<{
  onContinue: () => void;
  onLogoSelected: (file: File) => Promise<void>;
  onProfilePhotoSelected: (file: File) => Promise<void>;
  onValidationFailure: (fieldIds: string[]) => void;
  starter: StarterId | null;
}>;

function renderBrandBasics(
  handlers: BrandBasicsHandlers = {},
  fixedProfile?: BusinessProfileDraft,
  profileOverrides: Partial<BusinessProfileDraft> = {},
) {
  function Harness() {
    const { profile, update } = useProfileHarness();
    return (
      <BrandBasicsScreen
        profile={fixedProfile ?? { ...profile, ...profileOverrides }}
        starter={handlers.starter === undefined ? 'one_page' : handlers.starter}
        onBack={vi.fn()}
        onContinue={handlers.onContinue ?? vi.fn()}
        onLogoSelected={handlers.onLogoSelected ?? vi.fn()}
        onProfileChange={fixedProfile ? vi.fn() : update}
        onProfilePhotoSelected={handlers.onProfilePhotoSelected ?? vi.fn()}
        onValidationFailure={handlers.onValidationFailure}
      />
    );
  }
  return render(<Harness />);
}

describe('BrandBasicsScreen', () => {
  it('shows associated inline errors, then continues with shared profile values', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onValidationFailure = vi.fn();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <BrandBasicsScreen
          profile={profile}
          starter="one_page"
          onBack={vi.fn()}
          onContinue={onContinue}
          onLogoSelected={vi.fn()}
          onProfileChange={update}
          onProfilePhotoSelected={vi.fn()}
          onValidationFailure={onValidationFailure}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getAllByText('Add your salon or studio name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add your name.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Choose who you’re setting Luster up for.').length)
      .toBeGreaterThan(0);
    expect(onValidationFailure).toHaveBeenCalledWith([
      'businessName',
      'ownerName',
      'businessStructure',
    ]);

    await user.type(screen.getByLabelText('Salon or studio name'), 'Isla Nail Studio');
    await user.type(screen.getByLabelText('Your name'), 'Daniela');
    await user.click(screen.getByRole('radio', { name: 'Solo nail tech' }));
    expect(screen.getByRole('group', { name: 'Who are you setting Luster up for?' }))
      .toBeVisible();
    expect(screen.getByRole('radio', { name: 'Team or multi-tech salon' })).toBeVisible();
    expect(screen.queryByRole('radio', { name: 'Home studio' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your site so far' }))
      .toHaveTextContent('Isla Nail StudioDanielaSolo nail tech');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText(/website url/i)).not.toBeInTheDocument();
  });

  it('personalizes the live starter preview as the owner types', async () => {
    const user = userEvent.setup();
    renderBrandBasics();

    expect(screen.getByText('One-page website · Change it anytime')).toBeVisible();
    const poster = document.querySelector('[data-testid="starter-preview-one_page"]');
    expect(poster).not.toBeNull();
    expect(poster).toHaveAttribute('data-preview-state', 'poster');
    expect(poster).toHaveTextContent('Your studio');

    await user.type(screen.getByLabelText('Salon or studio name'), 'Isla Nail Studio');
    expect(poster).toHaveTextContent('Isla Nail Studio');
    expect(poster).not.toHaveTextContent('Your studio');
  });

  it('keeps branding collapsed until opened, then exposes real file controls', async () => {
    const user = userEvent.setup();
    const onProfilePhotoSelected = vi.fn().mockResolvedValue(undefined);
    renderBrandBasics(
      { onProfilePhotoSelected },
      undefined,
      { businessName: 'Isla Nail Studio', ownerName: 'Daniela' },
    );

    const brandingTrigger = screen.getByRole('button', { name: /Branding/ });
    expect(brandingTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(brandingTrigger).toHaveTextContent('Photo, logo and Instagram · Optional');
    await user.click(brandingTrigger);
    expect(brandingTrigger).toHaveAttribute('aria-expanded', 'true');

    const identity = screen.getByRole('group', { name: 'Your site so far' });
    expect(identity).toHaveTextContent('Isla Nail Studio');
    const photo = new File(['portrait'], 'daniela.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Profile photo'), photo);
    expect(onProfilePhotoSelected).toHaveBeenCalledWith(photo);
    await user.type(screen.getByLabelText('Instagram handle'), '@islanail.studio');
    expect(identity).toHaveTextContent('@islanail.studio');
    expect(screen.getByText('Enter a username or paste an Instagram profile link.'))
      .toBeVisible();
    expect(screen.queryByLabelText('Website')).not.toBeInTheDocument();
  });

  it('normalizes a pasted Instagram profile URL and blocks invalid owner input', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderBrandBasics(
      { onContinue },
      undefined,
      {
        businessName: 'Isla Nail Studio',
        businessStructure: 'solo',
        ownerName: 'Daniela',
      },
    );

    await user.click(screen.getByRole('button', { name: /Branding/ }));
    const instagram = screen.getByLabelText('Instagram handle');
    await user.type(instagram, 'https://www.instagram.com/islanailstudio/');
    await user.tab();
    expect(instagram).toHaveValue('islanailstudio');
    expect(screen.getByRole('group', { name: 'Your site so far' }))
      .toHaveTextContent('@islanailstudio');

    await user.clear(instagram);
    await user.type(instagram, 'isla nail studio');
    expect(instagram).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(
      'Enter only your Instagram username, such as islanailstudio.',
    )).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    await waitFor(() => expect(instagram).toHaveFocus());
  });

  it('shows distinct role-correct ready thumbnails without crossing Profile and Logo', () => {
    const profile = createDefaultBusinessProfile();
    profile.businessName = 'Isla Nail Studio';
    profile.ownerName = 'Daniela';
    profile.profilePhoto = {
      fileName: 'daniela-portrait.png',
      id: 'fixture-profile',
      mimeType: 'image/png',
      previewUrl: 'https://example.test/daniela-portrait.png',
      source: 'fixture',
    };
    profile.logo = {
      fileName: 'isla-wordmark.png',
      id: 'fixture-logo',
      mimeType: 'image/png',
      previewUrl: 'https://example.test/isla-wordmark.png',
      source: 'fixture',
    };

    renderBrandBasics({}, profile);

    expect(screen.getByRole('button', { name: /Branding/ }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Profile photo ready')).toBeVisible();
    expect(screen.getByText('Logo ready')).toBeVisible();
    expect(screen.getByAltText('Daniela profile photo thumbnail'))
      .toHaveAttribute('src', 'https://example.test/daniela-portrait.png');
    expect(screen.getByAltText('Isla Nail Studio logo thumbnail'))
      .toHaveAttribute('src', 'https://example.test/isla-wordmark.png');
    const identity = screen.getByRole('group', { name: 'Your site so far' });
    expect(within(identity).getByRole('img', { name: 'Daniela profile photo' }))
      .toHaveAttribute('src', 'https://example.test/daniela-portrait.png');
    expect(within(identity).queryByRole('img', { name: /logo/iu })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Profile photo').closest('[data-media-role]'))
      .toHaveAttribute('data-media-role', 'profile');
    expect(screen.getByLabelText('Logo').closest('[data-media-role]'))
      .toHaveAttribute('data-media-role', 'logo');
  });

  it('keeps Profile and Logo replace/remove actions scoped to their own fields', async () => {
    const user = userEvent.setup();
    const profile = createDefaultBusinessProfile();
    profile.profilePhoto = {
      fileName: 'daniela-portrait.png',
      id: 'fixture-profile',
      mimeType: 'image/png',
      previewUrl: 'https://example.test/daniela-portrait.png',
      source: 'fixture',
    };
    profile.logo = {
      fileName: 'isla-wordmark.png',
      id: 'fixture-logo',
      mimeType: 'image/png',
      previewUrl: 'https://example.test/isla-wordmark.png',
      source: 'fixture',
    };
    const onLogoSelected = vi.fn().mockResolvedValue(undefined);
    const onProfileChange = vi.fn();
    const onProfilePhotoSelected = vi.fn().mockResolvedValue(undefined);

    render(
      <BrandBasicsScreen
        profile={profile}
        starter="quick_book"
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onLogoSelected={onLogoSelected}
        onProfileChange={onProfileChange}
        onProfilePhotoSelected={onProfilePhotoSelected}
      />,
    );

    const profileField = screen.getByLabelText('Profile photo').closest('[data-media-role]');
    const logoField = screen.getByLabelText('Logo').closest('[data-media-role]');
    if (!profileField || !logoField) throw new Error('Expected both media fields.');

    await user.upload(
      screen.getByLabelText('Profile photo'),
      new File(['profile'], 'replacement-profile.png', { type: 'image/png' }),
    );
    expect(onProfilePhotoSelected).toHaveBeenCalledOnce();
    expect(onLogoSelected).not.toHaveBeenCalled();

    await user.upload(
      screen.getByLabelText('Logo'),
      new File(['logo'], 'replacement-logo.png', { type: 'image/png' }),
    );
    expect(onLogoSelected).toHaveBeenCalledOnce();
    expect(onProfilePhotoSelected).toHaveBeenCalledOnce();

    await user.click(within(profileField as HTMLElement).getByRole('button', { name: 'Remove' }));
    expect(onProfileChange).toHaveBeenLastCalledWith({ profilePhoto: undefined });
    await user.click(within(logoField as HTMLElement).getByRole('button', { name: 'Remove' }));
    expect(onProfileChange).toHaveBeenLastCalledWith({ logo: undefined });
  });

  it('identifies migrated metadata-only images and offers a truthful reselect action', () => {
    const profile = createDefaultBusinessProfile();
    profile.profilePhoto = {
      fileName: 'saved-owner.png',
      id: 'legacy-owner-photo',
      mimeType: 'image/png',
      source: 'missing',
    };
    profile.logo = {
      fileName: 'saved-logo.webp',
      id: 'legacy-logo',
      mimeType: 'image/webp',
      source: 'missing',
    };

    renderBrandBasics({}, profile);

    expect(screen.getByText(
      'This saved profile photo is no longer available on this device. Select it again to restore it.',
    )).toBeVisible();
    expect(screen.getByText(
      'This saved logo is no longer available on this device. Select it again to restore it.',
    )).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Select again' })).toHaveLength(2);
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
    await user.click(screen.getByRole('radio', { name: 'Salon suite' }));
    await user.click(screen.getByRole('button', { name: /^Contact/u }));
    expect(screen.getByRole('button', { name: /Location/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Contact/u })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('switch', {
      name: 'Clients should use online booking only',
    }));

    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1 answer needs attention.');
    expect(screen.getAllByText(
      'Add a phone number, email or Instagram so clients can reach you—or choose “Clients should use online booking only” to keep your details private.',
    ).length).toBeGreaterThan(0);
    expect(screen.getByRole('group', { name: 'Clients can:' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const primaryNumber = screen.getByLabelText('Phone number clients can use');
    await waitFor(() => expect(primaryNumber).toHaveFocus());
    expect(primaryNumber).toHaveAttribute('aria-invalid', 'true');
    const contactDescriptionId = primaryNumber.getAttribute('aria-describedby');
    expect(contactDescriptionId).toBeTruthy();
    expect(document.getElementById(contactDescriptionId ?? '')).toHaveTextContent(
      'Add a phone number, email or Instagram so clients can reach you—or choose “Clients should use online booking only” to keep your details private.',
    );
    await user.click(screen.getByRole('switch', {
      name: 'Clients should use online booking only',
    }));
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
    await user.click(screen.getByRole('button', { name: /^Contact/u }));
    await user.click(screen.getByRole('switch', {
      name: 'Clients should use online booking only',
    }));
    await user.type(screen.getByLabelText('Phone number clients can use'), '416-555-0100');
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
    expect(screen.queryByRole('radio', { name: 'Call' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: /Contact Call shown first/u,
    })).toBeVisible();
    expect(screen.queryByLabelText('Text message number')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', {
      name: 'Clients should use online booking only',
    }));
    expect(within(preview).getByText('Booking is the best way to reach us')).toBeVisible();
    expect(within(preview).queryByText('416-555-0100')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Phone number clients can use')).toHaveValue('416-555-0100');
  });

  it('keeps invalid Instagram out of Contact completion and normalizes a valid URL', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    function Harness() {
      const { profile, update } = useProfileHarness();
      return (
        <LocationContactScreen
          profile={{
            ...profile,
            location: {
              ...profile.location,
              cityOrArea: 'Toronto',
              locationType: 'salon_suite',
            },
          }}
          onBack={vi.fn()}
          onContinue={onContinue}
          onProfileChange={update}
          onSkipHours={vi.fn()}
          previewTimestamp="2026-08-27T18:30:00.000Z"
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /^Contact/u }));
    await user.click(screen.getByRole('switch', {
      name: 'Clients should use online booking only',
    }));
    const instagram = screen.getByLabelText('Instagram handle');
    await user.type(instagram, 'instagram.com/isla/reels');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(instagram).toBeVisible();
    await waitFor(() => expect(instagram).toHaveFocus());
    expect(screen.getByRole('button', { name: /^Contact/u })).toHaveTextContent('Finish');
    expect(screen.getByRole('button', { name: /^Contact/u })).not.toHaveTextContent('Complete');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    await waitFor(() => expect(instagram).toHaveFocus());

    await user.clear(instagram);
    await user.type(instagram, 'https://instagram.com/islanailstudio/');
    await user.tab();
    expect(instagram).toHaveValue('islanailstudio');
    expect(screen.getByRole('button', { name: /^Contact/u })).toHaveTextContent(
      'Instagram shown first',
    );
    expect(screen.getByRole('button', { name: /^Contact/u })).toHaveTextContent('Complete');
  });

  it('applies one regular schedule and keeps individual Closed controls', async () => {
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
    expect(screen.getByRole('radio', { name: 'Monday–Saturday' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Edit Monday hours' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Opens' }), '11:00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Closes' }), '18:00');
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));
    expect(screen.getByRole('button', { name: 'Edit Friday hours' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Hours/ })).toHaveTextContent(
      'Mon–Sat · 11:00 AM–6:00 PM',
    );
    await user.click(screen.getByRole('button', { name: 'Edit Sunday hours' }));
    expect(screen.getByRole('checkbox', { name: 'Closed' })).toBeChecked();
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
    expect(hoursCard).toHaveTextContent('Add your business hours');
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();

    await user.click(hoursCard);
    const showHours = screen.getByRole('switch', { name: 'Show hours on my website' });
    expect(showHours).toBeDisabled();
    expect(showHours).not.toBeChecked();
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Custom days' }));
    for (const day of ['Mon', 'Tue', 'Wed', 'Fri', 'Sat']) {
      await user.click(screen.getByRole('checkbox', { name: day }));
    }
    await user.selectOptions(screen.getByRole('combobox', { name: 'Opens' }), '10:00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Closes' }), '18:00');
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));
    expect(showHours).toBeEnabled();
    expect(showHours).toBeChecked();
    expect(within(preview).getByText('Open until 6:00 PM')).toBeVisible();

    await user.click(screen.getByRole('switch', { name: 'Show hours on my website' }));
    expect(hoursCard).toHaveTextContent('Not shown on your website');
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();

    await user.click(showHours);
    expect(showHours).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Skip hours for now' }));
    expect(hoursCard).toHaveTextContent('Not shown on your website');
    expect(hoursCard).not.toHaveTextContent('Complete');
    expect(showHours).not.toBeChecked();
    expect(within(preview).queryByText(/Open until|Closed/u)).not.toBeInTheDocument();
  });
});
