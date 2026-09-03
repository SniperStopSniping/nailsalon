import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Booking layout mobile presentation', () => {
  it('keeps the confirmation action primary and Back visually secondary', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/onboarding/booking-layout-screen.css'),
      'utf8',
    );

    expect(css).toMatch(
      /onboarding-screen--booking-layout[\s\S]*?button\.sticky-onboarding-actions__primary \{[^}]*width: 100%;[^}]*grid-column: 1 \/ -1;[^}]*background: var\(--onboarding-accent\);/u,
    );
    expect(css).toMatch(
      /onboarding-screen--booking-layout[\s\S]*?button\.sticky-onboarding-actions__back \{[^}]*width: auto;[^}]*justify-self: start;[^}]*background: var\(--onboarding-surface\);/u,
    );
  });

  it('keeps the Clean List total on one readable line', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/booking/booking.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.clean-service-count \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/u,
    );
  });
});
