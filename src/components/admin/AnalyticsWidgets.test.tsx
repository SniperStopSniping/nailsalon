import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('AnalyticsWidgets owner report controls', () => {
  it('provides a visible Back action and preserves period and navigation callbacks', () => {
    const onBack = vi.fn();
    const onTimePeriodChange = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onToday = vi.fn();
    render(<AnalyticsWidgets onBack={onBack} onTimePeriodChange={onTimePeriodChange} onPrev={onPrev} onNext={onNext} onToday={onToday} anchorDate="2020-01-06" timePeriod="Weekly" />);

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onBack).toHaveBeenCalledOnce();

    const periods = within(screen.getByRole('group', { name: 'Report period' }));

    expect(periods.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(periods.getByRole('button', { name: 'Monthly' }));

    expect(onTimePeriodChange).toHaveBeenCalledWith('Monthly');

    fireEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onToday).toHaveBeenCalledOnce();
  });

  it('labels date selection and returns focus when cancelled or changed', async () => {
    const onAnchorChange = vi.fn();
    render(<AnalyticsWidgets onAnchorChange={onAnchorChange} anchorDate="2020-01-06" />);
    const toggle = screen.getByRole('button', { name: 'Jan 6 - Jan 12, 2020' });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.change(screen.getByLabelText('Jump to date'), { target: { value: '2020-02-03' } });

    expect(onAnchorChange).toHaveBeenCalledWith('2020-02-03');
    expect(toggle).toHaveFocus();

    await waitFor(() => expect(screen.queryByLabelText('Jump to date')).not.toBeInTheDocument());
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByLabelText('Jump to date'), { key: 'Escape' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('shows actual utilization percentages and keeps empty states truthful', () => {
    render(<AnalyticsWidgets utilization={[{ name: 'A long technician name', percent: 72, color: '#8f3155' }]} />);
    const utilization = within(screen.getByRole('region', { name: 'Utilization' }));

    expect(utilization.getByText('A long technician name')).toBeInTheDocument();
    expect(utilization.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('No services data available')).toBeInTheDocument();
    expect(screen.getByText('No staff data available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View All Staff' })).not.toBeInTheDocument();
  });
});
