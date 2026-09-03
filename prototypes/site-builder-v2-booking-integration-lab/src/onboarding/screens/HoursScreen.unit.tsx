import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultBusinessProfile } from '../model/defaults';
import { applyRegularHours } from '../model/hours';
import { HoursScreen } from './HoursScreen';

describe('HoursScreen', () => {
  function renderScreen(initial = createDefaultBusinessProfile()) {
    let latest = initial;
    const onContinue = vi.fn();
    function Harness() {
      const [profile, setProfile] = useState(initial);
      return (
        <HoursScreen
          onBack={vi.fn()}
          onContinue={onContinue}
          onProfileChange={(patch) => {
            const next = { ...profile, ...patch };
            latest = next;
            setProfile(next);
          }}
          onSkipHours={vi.fn()}
          profile={profile}
        />
      );
    }
    render(<Harness />);
    return { getLatest: () => latest, onContinue };
  }

  it('starts with one focused Hours card and blocks continuing until configured', () => {
    renderScreen();

    expect(screen.getByRole('heading', { name: 'When are you open?' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Hours Set up/u })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Monday–Saturday' })).toBeChecked();
  });

  it('applies a regular week, exposes public visibility, and shows a compact summary', async () => {
    const user = userEvent.setup();
    const { getLatest } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    expect(screen.getByRole('status')).toHaveTextContent('Regular hours applied to 6 days.');
    expect(screen.getByRole('switch', { name: 'Show business hours to clients' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
    expect(getLatest().hours.days.sunday.closed).toBe(true);

    await user.click(screen.getByRole('button', { name: /Hours Complete/u }));

    expect(screen.getByRole('button', { name: /Hours Mon–Sat · 10:00 AM–7:00 PM Complete/u }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a valid schedule while truthfully marking public hours hidden', async () => {
    const user = userEvent.setup();
    const initial = createDefaultBusinessProfile();
    initial.hours = applyRegularHours(
      initial.hours,
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      '10:00',
      '19:00',
    )!;
    renderScreen(initial);

    await user.click(screen.getByRole('switch', { name: 'Show business hours to clients' }));

    expect(screen.getByRole('button', { name: /Hours Saved, not shown/u })).toBeVisible();
  });

  it('updates the canonical timezone from the secondary dialog', async () => {
    const user = userEvent.setup();
    const { getLatest } = renderScreen();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.selectOptions(screen.getByLabelText('Salon timezone'), 'America/Vancouver');
    await user.click(screen.getByRole('button', { name: 'Save timezone' }));

    expect(getLatest().timeZone).toBe('America/Vancouver');
    expect(screen.getByText('America/Vancouver')).toBeVisible();
  });
});
