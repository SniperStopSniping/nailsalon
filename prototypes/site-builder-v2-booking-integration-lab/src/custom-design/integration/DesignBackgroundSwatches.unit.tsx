import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DesignBackgroundSwatches } from './DesignBackgroundSwatches';

describe('DesignBackgroundSwatches', () => {
  it('lets owners choose a colour by name and reflects the saved selection', async () => {
    const onChange = vi.fn();
    render(<DesignBackgroundSwatches onChange={onChange} selectedColor="#fbe8ef" />);

    expect(screen.getByRole('button', { name: 'Use blush background' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Use cream background' }));

    expect(onChange).toHaveBeenCalledWith('#FFF8F0');
    expect(screen.getByRole('button', { name: 'Use blush background' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not change a draft while controls are disabled', async () => {
    const onChange = vi.fn();
    render(<DesignBackgroundSwatches disabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use cream background' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
