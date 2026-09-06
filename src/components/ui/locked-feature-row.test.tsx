import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LockedFeatureRow } from './locked-feature-row';
import { describeLockedFeatureReason } from './lockedFeatureReason';

describe('describeLockedFeatureReason', () => {
  it('maps the modules API reason codes to owner-facing copy', () => {
    expect(describeLockedFeatureReason('UPGRADE_REQUIRED')).toBe(
      'Not included in your plan yet',
    );
    expect(describeLockedFeatureReason('MODULE_DISABLED')).toBe(
      'Turned off for this salon',
    );
  });

  it('never returns an empty explanation for an unknown or missing code', () => {
    expect(describeLockedFeatureReason(undefined)).toBe(
      'Not available for this salon yet',
    );
    expect(describeLockedFeatureReason(null)).toBe(
      'Not available for this salon yet',
    );
    expect(describeLockedFeatureReason('SOME_FUTURE_CODE')).toBe(
      'Not available for this salon yet',
    );
  });
});

describe('LockedFeatureRow', () => {
  it('names the feature and the reason it is unavailable', () => {
    render(<LockedFeatureRow name="Analytics Dashboard" reasonCode="UPGRADE_REQUIRED" />);

    expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Not included in your plan yet')).toBeInTheDocument();
    expect(
      screen.getByTestId('locked-feature-analytics-dashboard'),
    ).toHaveAttribute('data-locked-reason', 'UPGRADE_REQUIRED');
  });

  it('distinguishes a module the owner turned off from one the plan excludes', () => {
    render(<LockedFeatureRow name="Rewards" reasonCode="MODULE_DISABLED" />);

    expect(screen.getByText('Turned off for this salon')).toBeInTheDocument();
  });

  it('prefers explicit reason copy over the code', () => {
    render(
      <LockedFeatureRow
        name="Rewards"
        reasonCode="UPGRADE_REQUIRED"
        reason="Ask the salon owner to switch this on"
      />,
    );

    expect(
      screen.getByText('Ask the salon owner to switch this on'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Not included in your plan yet'),
    ).not.toBeInTheDocument();
  });

  it('renders an optional link and shows a Locked chip when there is none', () => {
    const { rerender } = render(<LockedFeatureRow name="Referrals" reasonCode="UPGRADE_REQUIRED" />);

    expect(screen.getByText('Locked')).toBeInTheDocument();

    rerender(
      <LockedFeatureRow
        name="Referrals"
        reasonCode="UPGRADE_REQUIRED"
        link={{ label: 'See plans', href: '/en/admin/luster' }}
      />,
    );

    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/en/admin/luster',
    );
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
  });
});
