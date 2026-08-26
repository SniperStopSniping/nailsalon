import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type { OriginStarter } from '../model/types';
import { StarterChooser } from './StarterChooser';

const STARTERS: ReadonlyArray<{
  badge: string;
  description: string;
  id: OriginStarter;
  name: string;
}> = [
  {
    badge: 'Starts with 3 sections',
    description: 'Fastest way to start taking bookings.',
    id: 'quick_book',
    name: 'Quick Book',
  },
  {
    badge: 'Starts with 6 sections',
    description: 'A complete scrolling salon website.',
    id: 'one_page',
    name: 'One-page website',
  },
  {
    badge: 'Starts with 5 pages',
    description: 'Separate pages with a navigation menu.',
    id: 'multi_page',
    name: 'Multi-page website',
  },
];

describe('StarterChooser accessibility', () => {
  it('introduces every starter before its decorative preview content', () => {
    render(<StarterChooser onChoose={vi.fn()} />);

    for (const starter of STARTERS) {
      const card = screen.getByRole('button', {
        name: new RegExp(`^${starter.name}`),
      });
      const copy = card.querySelector<HTMLElement>('.final-starter-card__copy');
      const preview = card.querySelector<HTMLElement>('.final-starter-mini');

      expect(copy).not.toBeNull();
      expect(preview).not.toBeNull();
      expect(copy?.nextElementSibling).toBe(preview);
      expect(preview).toHaveAttribute('aria-hidden', 'true');
      expect(card).toHaveAccessibleName(
        `${starter.name} ${starter.description} ${starter.badge} Choose this start`,
      );
      expect(card).not.toHaveAccessibleName(/Luster Nail Studio|Toronto nail artist/);
      expect(within(card).getByText('Choose this start')).toBeVisible();
    }
  });

  it('keeps the whole card keyboard- and pointer-activatable', async () => {
    const onChoose = vi.fn();
    const user = userEvent.setup();
    render(<StarterChooser onChoose={onChoose} />);

    const quickBook = screen.getByRole('button', { name: /^Quick Book/ });
    await user.click(quickBook);
    expect(onChoose).toHaveBeenLastCalledWith('quick_book');

    const multiPage = screen.getByRole('button', { name: /^Multi-page website/ });
    multiPage.focus();
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenLastCalledWith('multi_page');
    expect(onChoose).toHaveBeenCalledTimes(2);
  });
});
