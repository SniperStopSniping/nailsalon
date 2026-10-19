import { expect, it } from 'vitest';

import { websiteReviewLabel, websiteReviewValue } from './review-copy';

it('retains exact contact identifiers and every policy paragraph without exposing field keys', () => {
  const result = websiteReviewValue('website.content.websiteDetails', {
    instagram: '@paper_nails',
    email: 'book_me@example.test',
    phone: '+1 416 555 0108',
    locationDirections: 'Dixie_and_Countryside',
    sections: [{ id: 'arrival_notes', title: 'Arrival_notes', text: 'DM @paper_nails.\nKeep this second paragraph.' }],
  });

  expect(result).toContain('@paper_nails');
  expect(result).toContain('book_me@example.test');
  expect(result).toContain('Dixie_and_Countryside');
  expect(result).toContain('Arrival_notes\nDM @paper_nails.\nKeep this second paragraph.');
  expect(result).not.toContain('locationDirections:');
  expect(result).not.toContain('arrival_notes');
});

it('shows complete wording for later policy-only changes and an explicit empty list', () => {
  expect(websiteReviewValue('website.content.websiteDetails.sections', [
    { id: 'deposit', title: 'Deposit', text: '$15 is arranged directly with the salon.' },
    { id: 'guests', title: 'Guests', text: 'Please come alone.' },
  ])).toBe('Deposit\n$15 is arranged directly with the salon.\n\nGuests\nPlease come alone.');
  expect(websiteReviewValue('website.content.websiteDetails.sections', [])).toBe('None');
});

it('uses existing layout and colour names only for their configuration fields', () => {
  expect(websiteReviewValue('website.config.quickBookLayout', 'text_editorial')).toBe('Type Editorial');
  expect(websiteReviewValue('website.config.sitePalettePreset', 'luster_berry')).toBe('Luster Berry');
  expect(websiteReviewValue('website.content.bio', 'luster_berry')).toBeUndefined();
  expect(websiteReviewValue('website.content.websiteDetails.instagram', 'luster_berry')).toBeUndefined();
});

it('distinguishes public-field visibility changes and does not erase unfamiliar values', () => {
  expect(websiteReviewLabel('website.config.quickBookProfile.showEmail')).toBe('Show your public email');
  expect(websiteReviewLabel('website.config.quickBookProfile.showHours')).toBe('Show opening hours');
  expect(websiteReviewValue('website.config.quickBookProfile.showEmail', false)).toBe('Hidden');
  expect(websiteReviewValue('website.config.quickBookProfile.showEmail', true)).toBe('Shown when available');
  expect(websiteReviewValue('business.locationDisplayMode', 'after_booking')).toBe('Full address after a confirmed booking');
  expect(websiteReviewValue('booking.confirmationMode', 'request_approval')).toBe('Ask me to approve appointment requests');
  expect(websiteReviewValue('website.content.websiteDetails', { unfamiliar: 'keep_me' })).toBeUndefined();
});
