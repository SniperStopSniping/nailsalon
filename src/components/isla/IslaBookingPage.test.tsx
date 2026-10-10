import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IslaBookingPage } from './IslaBookingPage';

const props = {
  continueBar: <button type="button">Choose a time</button>,
  flow: ['service', 'time', 'confirm'] as Array<'service' | 'time' | 'confirm'>,
  manageHref: '/en/isla-nail-studio/find-booking',
  policy: null,
  moreCount: 0,
  categoryLabel: 'Manicure',
  onShowMore: vi.fn(),
  onSearch: vi.fn(),
};
const socials = {
  instagram: 'https://www.instagram.com/isla_contract_fixture/',
  facebook: 'https://www.facebook.com/isla.contract.fixture',
  tiktok: 'https://www.tiktok.com/@isla.contract.fixture',
};

describe('Isla saved social links', () => {
  it('uses the canonical Instagram URL in both existing placements and shows the saved handle', () => {
    render(<IslaBookingPage {...props} socialLinks={socials}><p>Canonical services</p></IslaBookingPage>);

    const header = screen.getByRole('navigation', { name: 'Studio links' });

    expect(within(header).getByRole('link', { name: 'Isla Nail Studio on Instagram' })).toHaveAttribute('href', socials.instagram);

    const gallery = screen.getByRole('navigation', { name: 'Salon social links' });

    expect(within(gallery).getByRole('link', { name: 'Isla Nail Studio on Instagram' })).toHaveAttribute('href', socials.instagram);
    expect(gallery).toHaveTextContent('@isla_contract_fixture');
  });

  it('makes configured Facebook and TikTok links available with their actual destinations', () => {
    render(<IslaBookingPage {...props} socialLinks={socials}><p>Canonical services</p></IslaBookingPage>);

    for (const [name, href] of [['Facebook', socials.facebook], ['TikTok', socials.tiktok]]) {
      const link = screen.getByRole('link', { name: `Isla Nail Studio on ${name}` });

      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('removes cleared social links instead of restoring a hardcoded profile', () => {
    const { rerender } = render(<IslaBookingPage {...props} socialLinks={socials}><p>Canonical services</p></IslaBookingPage>);
    rerender(<IslaBookingPage {...props} socialLinks={{ instagram: null, facebook: null, tiktok: null }}><p>Canonical services</p></IslaBookingPage>);

    expect(screen.queryByRole('navigation', { name: 'Salon social links' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /on Instagram|on Facebook|on TikTok/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Manage my booking' })).toHaveLength(2);
  });

  it('keeps the commissioned hero, photography and booking content intact', () => {
    render(<IslaBookingPage {...props} socialLinks={socials}><p>Canonical services</p></IslaBookingPage>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your nextbeautiful set.');

    const logo = screen.getByRole('img', { name: 'Isla Nail Studio' });
    const hero = screen.getByRole('img', { name: /Both hands showing/ });

    expect(new URL(logo.getAttribute('src')!, 'https://example.test').searchParams.get('url')).toBe('/isla/isla-logo-original.jpg');
    expect(new URL(hero.getAttribute('src')!, 'https://example.test').searchParams.get('url')).toBe('/isla/gel-x.jpg');
    expect(hero).toHaveAttribute('srcset');
    expect(hero).toHaveAttribute('sizes', expect.stringContaining('100vw'));
    expect(hero).not.toHaveAttribute('loading', 'lazy');
    expect(screen.getByText('Canonical services')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose a time' })).toBeVisible();
  });
});
