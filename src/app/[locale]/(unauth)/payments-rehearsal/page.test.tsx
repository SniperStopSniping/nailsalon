import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CustomerPaymentsRehearsalPage from './page';

const state = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/libs/customerPayments/rehearsal', () => ({ isCustomerPaymentsRehearsalEnabled: () => state.enabled }));
vi.mock('next/navigation', () => ({ notFound: () => {
  throw new Error('NEXT_NOT_FOUND');
} }));
vi.mock('@/components/customerPayments/CustomerPaymentsRehearsal', () => ({ CustomerPaymentsRehearsal: () => <div>Test setup only</div> }));

beforeEach(() => {
  state.enabled = false;
});

describe('customer payments rehearsal page', () => {
  it('is unavailable when the server gate refuses it', () => {
    expect(() => CustomerPaymentsRehearsalPage()).toThrow('NEXT_NOT_FOUND');
  });

  it('renders only after the server gate permits the rehearsal', () => {
    state.enabled = true;
    render(CustomerPaymentsRehearsalPage());

    expect(screen.getByText('Test setup only')).toBeInTheDocument();
  });
});
