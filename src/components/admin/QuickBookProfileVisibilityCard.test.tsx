import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';

import { QuickBookProfileVisibilityCard } from './QuickBookProfileVisibilityCard';

const visibility = {
  showBio: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showEmail: true,
  showHours: false,
  showInstagram: false,
  showLocation: false,
  showPhone: false,
  showReviews: false,
  showTechName: true,
  showTechPhoto: false,
};

const draft = (layout: BookingPageConfigSide['layout']) => ({
  layout,
  quickBookProfile: { ...visibility },
});

describe('QuickBookProfileVisibilityCard', () => {
  it('renders eleven semantic, full-row Quick Book switches without copying salon content', async () => {
    const onConfigPatch = vi.fn();
    const { container } = render(
      <QuickBookProfileVisibilityCard
        disabled={false}
        draft={draft('quick_book')}
        onConfigPatch={onConfigPatch}
      />,
    );

    const switches = screen.getAllByRole('switch');

    expect(switches).toHaveLength(11);
    expect(screen.getByRole('switch', { name: /Show nail tech name/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Show phone/i })).not.toBeChecked();
    expect(container.querySelectorAll('label.min-h-11')).toHaveLength(11);
    expect(screen.getByText(/underlying detail stays saved and shared/i)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/Isla|Daniela|@|\.com/i);

    const expectedPatches = [
      ['Show nail tech name', 'showTechName', false],
      ['Show nail tech photo', 'showTechPhoto', true],
      ['Show location', 'showLocation', true],
      ['Show business hours', 'showHours', true],
      ['Show phone', 'showPhone', true],
      ['Show email', 'showEmail', false],
      ['Show booking policy', 'showBookingPolicy', true],
      ['Show cancellation policy', 'showCancellationPolicy', true],
      ['Show reviews', 'showReviews', true],
      ['Show Instagram / work', 'showInstagram', true],
      ['Show short bio', 'showBio', true],
    ] as const;
    for (const [label, key, nextValue] of expectedPatches) {
      await userEvent.click(screen.getByRole('switch', { name: new RegExp(label, 'i') }));

      expect(onConfigPatch).toHaveBeenLastCalledWith({
        quickBookProfile: { [key]: nextValue },
      });
    }

    expect(onConfigPatch).toHaveBeenCalledTimes(11);
  });

  it('renders nothing for a non-Quick-Book draft', () => {
    const { container } = render(
      <QuickBookProfileVisibilityCard
        disabled={false}
        draft={draft('editorial')}
        onConfigPatch={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('disables every switch while a presentation operation is in progress', () => {
    render(
      <QuickBookProfileVisibilityCard
        disabled
        draft={draft('quick_book')}
        onConfigPatch={vi.fn()}
      />,
    );

    for (const control of screen.getAllByRole('switch')) {
      expect(control).toBeDisabled();
    }
  });
});
