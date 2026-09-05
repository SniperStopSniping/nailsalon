import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OwnerWorkspaceNav } from './OwnerWorkspaceNav';

const TAB_NAMES = ['Today', 'Calendar', 'Clients', 'Services', 'More'];

describe('OwnerWorkspaceNav', () => {
  it('presents the workspace sections as a labelled tablist', () => {
    render(<OwnerWorkspaceNav active="today" onSelect={vi.fn()} />);

    expect(
      screen.getByRole('tablist', { name: 'Owner workspace sections' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(TAB_NAMES.length);

    for (const name of TAB_NAMES) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('marks exactly the active section as selected', () => {
    render(<OwnerWorkspaceNav active="clients" onSelect={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Clients' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(
      screen.getAllByRole('tab').filter(
        tab => tab.getAttribute('aria-selected') === 'true',
      ),
    ).toHaveLength(1);
  });

  it('keeps every tab reachable with the Tab key', async () => {
    const user = userEvent.setup();
    render(<OwnerWorkspaceNav active="today" onSelect={vi.fn()} />);

    for (const name of TAB_NAMES) {
      await user.tab();

      expect(screen.getByRole('tab', { name })).toHaveFocus();
    }
  });

  it('moves between tabs with the arrow keys and wraps at the ends', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OwnerWorkspaceNav active="today" onSelect={onSelect} />);

    screen.getByRole('tab', { name: 'Today' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onSelect).toHaveBeenLastCalledWith('calendar');
    expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveFocus();

    // Wrapping: ArrowLeft from the first tab lands on the last one.
    screen.getByRole('tab', { name: 'Today' }).focus();
    await user.keyboard('{ArrowLeft}');

    expect(onSelect).toHaveBeenLastCalledWith('more');
    expect(screen.getByRole('tab', { name: 'More' })).toHaveFocus();
  });

  it('selects a section when its tab is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OwnerWorkspaceNav active="today" onSelect={onSelect} />);

    await user.click(screen.getByRole('tab', { name: 'Services' }));

    expect(onSelect).toHaveBeenCalledWith('services');
  });
});
