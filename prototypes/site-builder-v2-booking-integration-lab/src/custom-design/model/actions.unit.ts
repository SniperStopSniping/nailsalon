import {
  normalizeEmailAddress,
  normalizeInternalHref,
  normalizePhoneNumber,
  parseCustomDesignAction,
  parseSafeHttpsUrl,
  resolveContactCta,
  resolveCustomDesignAction,
} from './actions';
import type { CustomDesignAction } from './types';

describe('Custom Design structured actions', () => {
  const cases: Array<{
    action: CustomDesignAction;
    href: string;
    external: boolean;
  }> = [
    {
      action: { type: 'start_booking' },
      href: '#booking-section',
      external: false,
    },
    {
      action: { type: 'directions', destination: { address: '123 Main St' } },
      href: 'https://www.google.com/maps/search/?api=1&query=123%20Main%20St',
      external: true,
    },
    {
      action: { type: 'instagram', destination: { username: 'luster.nails' } },
      href: 'https://www.instagram.com/luster.nails/',
      external: true,
    },
    {
      action: { type: 'website', destination: { url: 'https://example.com/book' } },
      href: 'https://example.com/book',
      external: true,
    },
    {
      action: { type: 'call', destination: { phoneNumber: '+14165551212' } },
      href: 'tel:+14165551212',
      external: false,
    },
    {
      action: { type: 'text', destination: { phoneNumber: '+14165551212' } },
      href: 'sms:+14165551212',
      external: false,
    },
    {
      action: {
        type: 'email',
        destination: { email: 'hello@example.com', subject: 'Nail appointment' },
      },
      href: 'mailto:hello@example.com?subject=Nail%20appointment',
      external: false,
    },
    {
      action: {
        type: 'internal',
        destination: { pageId: 'page_services', sectionId: 'section_booking' },
      },
      href: '/services#section_booking',
      external: false,
    },
    {
      action: { type: 'custom_url', destination: { url: 'https://example.org/policy' } },
      href: 'https://example.org/policy',
      external: true,
    },
  ];

  it.each(cases)('resolves $action.type as a semantic href', ({ action, href, external }) => {
    const resolution = resolveCustomDesignAction(action, {
      bookingHref: '#booking-section',
      resolveInternalHref: () => '/services#section_booking',
    });

    expect(resolution).toMatchObject({ status: 'resolved', href, external });

    if (resolution.status === 'resolved' && external) {
      expect(resolution).toMatchObject({
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    }
  });

  it('normalizes bounded destination data', () => {
    expect(parseCustomDesignAction({
      type: 'instagram',
      destination: { username: '@luster.nails' },
    })).toEqual({
      type: 'instagram',
      destination: { username: 'luster.nails' },
    });
    expect(normalizePhoneNumber('(416) 555-1212')).toBe('4165551212');
    expect(parseSafeHttpsUrl('https://example.com')).toBe('https://example.com/');
    expect(parseSafeHttpsUrl('  HTTPS://EXAMPLE.COM/Policy  '))
      .toBe('https://example.com/Policy');
    expect(normalizeEmailAddress('Owner@EXAMPLE.COM')).toBe('Owner@example.com');
  });

  it('rejects unsafe or untyped destinations', () => {
    expect(parseSafeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(parseSafeHttpsUrl('http://example.com')).toBeNull();
    expect(parseSafeHttpsUrl('https://user:password@example.com')).toBeNull();
    expect(parseCustomDesignAction({
      type: 'website',
      destination: { url: 'javascript:alert(1)' },
    })).toBeNull();
    expect(parseCustomDesignAction({
      type: 'custom_url',
      destination: { url: 'https://example.com', script: 'alert(1)' },
    })).toBeNull();
    expect(parseCustomDesignAction({
      type: 'internal',
      destination: { pageId: '../../admin' },
    })).toBeNull();
    expect(normalizePhoneNumber('555-CALL-NOW')).toBeNull();
    expect(normalizeEmailAddress('owner@example.com?subject=Policy')).toBeNull();
    expect(normalizeEmailAddress('owner@example.com&bcc=attacker@example.com')).toBeNull();
    expect(parseCustomDesignAction({
      type: 'email',
      destination: {
        email: 'owner@example.com',
        subject: 'Policy\r\nBcc: attacker@example.com',
      },
    })).toBeNull();
  });

  it('normalizes internal routes and rejects route-confusion inputs', () => {
    expect(normalizeInternalHref('  /services/../booking?from=design#start  '))
      .toBe('/booking?from=design#start');
    expect(normalizeInternalHref('#Book now')).toBe('#Book%20now');
    expect(normalizeInternalHref('/\\evil')).toBeNull();
    expect(normalizeInternalHref('//evil.example/path')).toBeNull();
    expect(normalizeInternalHref('/%5Cevil')).toBeNull();
    expect(normalizeInternalHref('/booking%0Aevil')).toBeNull();
  });

  it('keeps unresolved canonical and internal destinations inert', () => {
    expect(resolveCustomDesignAction({ type: 'start_booking' })).toEqual({
      status: 'unresolved',
      reason: 'booking_unavailable',
    });
    expect(resolveCustomDesignAction({
      type: 'internal',
      destination: { pageId: 'page_missing' },
    })).toEqual({
      status: 'unresolved',
      reason: 'internal_destination_unavailable',
    });
    expect(resolveContactCta({ contactHref: 'javascript:alert(1)' })).toEqual({
      status: 'unresolved',
      reason: 'contact_unavailable',
    });
    expect(resolveCustomDesignAction({ type: 'start_booking' }, {
      bookingHref: 'https://booking.example.com',
    })).toEqual({
      status: 'unresolved',
      reason: 'booking_unavailable',
    });
    expect(resolveCustomDesignAction({ type: 'start_booking' }, {
      bookingHref: '  /booking/../booking#start  ',
    })).toMatchObject({ status: 'resolved', href: '/booking#start', external: false });
    expect(resolveCustomDesignAction({
      type: 'internal',
      destination: { pageId: 'page_services' },
    }, {
      resolveInternalHref: () => '/\\evil',
    })).toEqual({
      status: 'unresolved',
      reason: 'internal_destination_unavailable',
    });
  });

  it('normalizes bounded contact destinations without permitting mail headers', () => {
    expect(resolveContactCta({
      contactHref: '  MAILTO:Owner@EXAMPLE.COM?subject=Hello World  ',
    })).toMatchObject({
      status: 'resolved',
      href: 'mailto:Owner@example.com?subject=Hello%20World',
      external: false,
    });
    expect(resolveContactCta({
      contactHref: 'mailto:owner@example.com?subject=Hello%0d%0aBcc%3Aattacker@example.com',
    })).toEqual({ status: 'unresolved', reason: 'contact_unavailable' });
  });
});
