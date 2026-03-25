import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./staff', () => ({
  StaffListView: () => <div>Staff list</div>,
  StaffDetailPage: () => null,
  AddStaffModal: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div>Add Staff Modal Open</div> : null
  ),
}));

import { StaffModal } from './StaffModal';

describe('StaffModal', () => {
  it('shows an explicit Add action in the header for empty/new salons', () => {
    render(<StaffModal onClose={() => {}} salonSlug="isla-nail-studio" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Add Staff Modal Open')).toBeInTheDocument();
  });
});
