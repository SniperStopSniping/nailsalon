import { render, screen } from '@testing-library/react';
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

    expect(screen.getAllByText('Included').length).toBeGreaterThan(1);
    expect(screen.getByText(/SMS credits/)).toBeInTheDocument();
    expect(screen.getByText('The owner manages texting and reminders in communication preferences.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /sms/i })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows built features as included without offering ineffective plan switches', () => {
    const onChange = vi.fn();
    render(<SalonFeatureAccessManager features={{ marketing: { rewards: false } }} onChange={onChange} />);

    expect(screen.getByText('Rewards')).toBeInTheDocument();
    expect(screen.getByText('Deposits & no-show protection')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Free Solo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Service variants (L1)')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
