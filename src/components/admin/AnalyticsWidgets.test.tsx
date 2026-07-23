import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnalyticsWidgets } from './AnalyticsWidgets';

describe('AnalyticsWidgets revenue comparison', () => {
  it('shows an unavailable delta instead of fabricating growth without prior revenue', () => {
    render(
      <AnalyticsWidgets
        revenue={12000}
        revenueTrend={0}
        revenueTrendAvailable={false}
        currency="CAD"
      />,
    );

    expect(screen.getByText('Completed appointment revenue')).toBeInTheDocument();
    expect(screen.getByText('No prior data')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});
