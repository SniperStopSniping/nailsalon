import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SmsMessagePreview } from './SmsMessagePreview';

describe('SmsMessagePreview', () => {
  it('shows the complete GSM customer body and one-credit summary', () => {
    render(<SmsMessagePreview body="Isla Nail Studio via Luster: Confirmed." sample />);

    expect(screen.getByText('Sample customer message')).toBeVisible();
    expect(screen.getByTestId('sms-segment-summary')).toHaveTextContent('1 text credit');
    expect(screen.getByText('Isla Nail Studio via Luster: Confirmed.')).toBeVisible();
    expect(screen.queryByText(/GSM-7/)).not.toBeInTheDocument();
  });

  it('explains Unicode and the extra segment when the final body needs it', () => {
    render(<SmsMessagePreview body={`${'A'.repeat(70)}😊`} />);

    expect(screen.getByTestId('sms-segment-summary')).toHaveTextContent('2 text credits');
    expect(screen.getByText(/Long messages and emoji/)).toBeVisible();
  });
});
