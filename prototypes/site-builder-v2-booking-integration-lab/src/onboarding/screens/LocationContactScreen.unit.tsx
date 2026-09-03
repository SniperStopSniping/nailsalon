import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import type { BusinessProfileDraft } from '../model/types';
import { LocationContactScreen } from './LocationContactScreen';

const useShortPhoneViewport = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: query === '(max-width: 479px) and (max-height: 700px)',
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderScreen(
  profilePatch: Partial<BusinessProfileDraft> = {},
  onContinue = vi.fn(),
  contactSetupConfirmed = false,
) {
  function Harness() {
    const [profile, setProfile] = useState<BusinessProfileDraft>({
      ...createDefaultBusinessProfile(),
      businessName: 'Isla Nail Studio',
      businessStructure: 'solo',
      businessType: 'independent_salon',
      ownerName: 'Daniela',
      ...profilePatch,
    });
    return (
      <LocationContactScreen
        contactSetupConfirmed={contactSetupConfirmed}
        profile={profile}
        onBack={vi.fn()}
        onContinue={onContinue}
        onProfileChange={(patch) => setProfile((current) => ({ ...current, ...patch }))}
      />
    );
  }
  return render(<Harness />);
}

describe('LocationContactScreen', () => {
  it('opens only Location and renders no customer/map preview', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Where can clients find you?' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Location/u })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Contact/u })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Arrival details/u })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('img', { name: /preview|map/iu })).not.toBeInTheDocument();
    expect(screen.queryByText('Business hours')).not.toBeInTheDocument();
  });

  it('collects an address once and keeps the three privacy choices self-contained', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText('City *'), 'Toronto');
    await user.type(screen.getByLabelText('Full address *'), '880 Ellesmere Rd, Scarborough, ON');

    const balanced = screen.getByRole('radio', {
      name: /Show my full address after they book/u,
    });
    expect(balanced).toBeChecked();
    expect(screen.queryByText('Before booking')).not.toBeInTheDocument();
    expect(screen.queryByText('After booking')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Show only my city/u }));
    expect(screen.getByRole('radio', { name: /Show only my city/u })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /Always show my full address/u }));
    expect(screen.getByRole('radio', { name: /Always show my full address/u })).toBeChecked();
  });

  it('uses a service-area form for mobile nail techs without an address question', async () => {
    const user = userEvent.setup();
    renderScreen({
      businessType: 'mobile',
      location: {
        ...createDefaultBusinessProfile().location,
        locationType: 'mobile_service',
      },
    });
    expect(screen.getByLabelText('Primary service area *')).toBeVisible();
    expect(screen.getByLabelText('Areas you serve · Optional')).toBeVisible();
    expect(screen.queryByLabelText(/address/iu)).not.toBeInTheDocument();
    expect(screen.queryByText('What should clients see? *')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Primary service area *'), 'Toronto');
    expect(screen.getByRole('button', { name: /^Location/u })).toHaveTextContent('Complete');
  });

  it('starts a completed Location as a compact editable summary on a short phone', async () => {
    useShortPhoneViewport();
    const user = userEvent.setup();
    renderScreen({
      location: {
        ...createDefaultBusinessProfile().location,
        addressVisibility: 'after_booking',
        cityOrArea: 'Toronto',
        exactAddress: '880 Ellesmere Rd',
      },
    });

    const locationCard = screen.getByRole('button', { name: /^Location/u });

    expect(locationCard).toHaveAttribute('aria-expanded', 'false');
    expect(locationCard).toHaveTextContent('Toronto · Address after booking');
    expect(locationCard).toHaveTextContent('Edit');
    expect(screen.queryByRole('textbox', { name: 'City *' })).not.toBeInTheDocument();

    await user.click(locationCard);

    expect(screen.getByRole('textbox', { name: 'City *' })).toHaveValue('Toronto');

    await user.click(screen.getByRole('button', { name: 'Done editing location' }));

    expect(locationCard).toHaveAttribute('aria-expanded', 'false');
  });

  it('invites owners to choose contact options instead of marking the untouched default complete', async () => {
    const user = userEvent.setup();
    renderScreen({ instagram: 'isla_nail_studio' });
    const contactCard = screen.getByRole('button', { name: /^Contact/u });

    expect(contactCard).toHaveTextContent('Add phone or email, or use online booking only');
    expect(contactCard).toHaveTextContent('Choose');
    expect(contactCard).not.toHaveTextContent('Complete');
    await user.click(contactCard);

    expect(screen.getByRole('radio', { name: /Online booking only/u })).not.toBeChecked();
    expect(screen.getByText('@isla_nail_studio')).toBeVisible();
    expect(screen.getByText('✓ Saved')).toBeVisible();
    expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Let clients contact me directly/u }));
    expect(screen.getByLabelText('Phone number')).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Clients can call this number' })).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Clients can text this number' })).toBeVisible();
    expect(screen.getByLabelText('Email · Optional')).toBeVisible();
  });

  it('marks Contact complete only after the owner explicitly chooses online booking only', async () => {
    const user = userEvent.setup();
    renderScreen();
    const contactCard = screen.getByRole('button', { name: /^Contact/u });
    await user.click(contactCard);

    expect(contactCard).not.toHaveTextContent('Complete');

    await user.click(screen.getByRole('radio', { name: /Online booking only/u }));
    expect(contactCard).toHaveTextContent('Online booking only');
    expect(contactCard).toHaveTextContent('Complete');
  });

  it('restores an explicitly confirmed online-booking contact choice', () => {
    renderScreen({}, vi.fn(), true);

    expect(screen.getByRole('button', { name: /^Contact/u })).toHaveTextContent('Complete');
  });

  it('keeps Arrival details optional and saves it in the canonical location', async () => {
    const user = userEvent.setup();
    renderScreen();
    const arrivalCard = screen.getByRole('button', { name: /^Arrival details/u });
    expect(arrivalCard).toHaveTextContent('Optional');
    await user.click(arrivalCard);
    await user.type(screen.getByLabelText('Parking'), 'Use the rear lot');
    await user.type(
      screen.getByLabelText('Entrance instructions'),
      'Inside TB Nails · Use the rear entrance',
    );
    expect(arrivalCard).toHaveTextContent('Arrival instructions added');
    expect(screen.getByText(/follow your address privacy choice/u)).toBeVisible();
  });

  it('requires the correct Location fields and then continues to Hours', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderScreen({}, onContinue);
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getAllByText('Add your city.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add the address clients will use for appointments.').length)
      .toBeGreaterThan(0);

    await user.type(screen.getByLabelText('City *'), 'Toronto');
    await user.type(screen.getByLabelText('Full address *'), '880 Ellesmere Rd');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(onContinue).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: /Online booking only/u }));
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
