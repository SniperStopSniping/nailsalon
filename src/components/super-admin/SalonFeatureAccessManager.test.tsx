import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SalonFeatures } from '@/types/salonPolicy';

import { SalonFeatureAccessManager } from './SalonFeatureAccessManager';

describe('SalonFeatureAccessManager SMS access', () => {
  it.each([
    {},
    { smsReminders: false },
    { marketing: { smsReminders: false } },
  ] satisfies SalonFeatures[])('includes SMS without an entitlement switch for stored features %j', (features) => {
    const onChange = vi.fn();
    render(<SalonFeatureAccessManager features={features} onChange={onChange} />);

    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.getByText(/SMS credits/)).toBeInTheDocument();
    expect(screen.getByText('The owner manages texting and reminders in communication preferences.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /sms/i })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves historical SMS flags when changing an unrelated optional feature', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SalonFeatureAccessManager
        features={{ smsReminders: false, marketing: { smsReminders: false } }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('switch', { name: 'Toggle Rewards' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      smsReminders: false,
      marketing: expect.objectContaining({ smsReminders: false, rewards: true }),
    }));
    expect(screen.queryByRole('switch', { name: /sms/i })).not.toBeInTheDocument();
  });
});
