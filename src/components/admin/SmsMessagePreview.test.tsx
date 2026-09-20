import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SmsMessagePreview } from './SmsMessagePreview';

describe('SmsMessagePreview', () => {
  it('shows the complete GSM customer body and one-credit summary', () => {
    render(<SmsMessagePreview body="Isla Nail Studio via Luster: Confirmed." sample />);

    expect(screen.getByText('Sample customer message')).toBeVisible();
    expect(screen.getByTestId('sms-segment-summary')).toHaveTextContent('1 SMS segment · 1 credit');
    expect(screen.getByText('Isla Nail Studio via Luster: Confirmed.')).toBeVisible();
    expect(screen.getByText(/GSM-7 units/)).toBeVisible();
  });

  it('explains Unicode and the extra segment when the final body needs it', () => {
    render(<SmsMessagePreview body={`${'A'.repeat(70)}😊`} />);

    expect(screen.getByTestId('sms-segment-summary')).toHaveTextContent('2 SMS segments · 2 credits');
    expect(screen.getByText(/Unicode characters \(U\+1F60A\) use fewer characters/)).toBeVisible();
    expect(screen.getByText(/Use straight punctuation and avoid emoji/)).toBeVisible();
    expect(screen.getByText('Keep this to 1 credit by shortening the message or link.')).toBeVisible();
  });
});
