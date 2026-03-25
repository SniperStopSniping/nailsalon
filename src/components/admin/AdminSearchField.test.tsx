import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminSearchField } from './AdminSearchField';

describe('AdminSearchField', () => {
  it('forwards input changes and supports clearing the current query', () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <AdminSearchField
        value=""
        onChange={onChange}
        placeholder="Search staff..."
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search staff...'), {
      target: { value: 'Taylor' },
    });

    expect(onChange).toHaveBeenCalledWith('Taylor');

    rerender(
      <AdminSearchField
        value="Taylor"
        onChange={onChange}
        placeholder="Search staff..."
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(onChange).toHaveBeenCalledWith('');
  });
});
