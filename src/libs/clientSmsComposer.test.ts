import { describe, expect, it } from 'vitest';

import {
  buildClientSmsMessage,
  buildNativeSmsUrl,
  type ClientSmsContext,
  composeClientSmsDraft,
  detectNativeSmsPlatform,
} from './clientSmsComposer';

const fullContext: ClientSmsContext = {
  client: {
    name: 'Ava Nguyen',
    phone: '+1 (416) 555-1234',
  },
  salon: {
    name: 'Isla Nail Studio',
    bookingUrl: 'https://islanailsalon.com/en/isla/book?source=rebook',
    googleReviewUrl: 'https://g.page/r/isla/review',
    timeZone: 'America/Toronto',
    currency: 'CAD',
    location: {
      address: '123 Queen St W',
      city: 'Toronto',
      state: 'ON',
      zipCode: 'M5H 2M9',
      parkingInstructions: 'Use the Green P lot behind the salon.',
    },
  },
  appointment: {
    startTime: '2026-07-17T23:00:00.000Z',
    endTime: '2026-07-18T00:30:00.000Z',
    serviceNames: ['Builder Gel Overlay'],
    artistName: 'Daniela',
    totalPriceCents: 6500,
    manageUrl: 'https://islanailsalon.com/manage/secure-token',
  },
};

describe('detectNativeSmsPlatform', () => {
  it('recognizes iPhone Chrome and Safari as iOS', () => {
    expect(detectNativeSmsPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) CriOS/138.0 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(detectNativeSmsPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe('ios');
  });

  it('recognizes iPad desktop mode as iOS and Android as other', () => {
    expect(detectNativeSmsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Mobile/15E148')).toBe('ios');
    expect(detectNativeSmsPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/138.0 Mobile Safari/537.36')).toBe('other');
    expect(detectNativeSmsPlatform(undefined)).toBe('other');
  });
});

describe('buildNativeSmsUrl', () => {
  it('normalizes the recipient and uses the iOS &body= separator', () => {
    const body = 'Hi Ava 😊 price is $65 & tax.';
    const href = buildNativeSmsUrl({
      phone: '+1 (416) 555-1234',
      body,
      platform: 'ios',
    });

    expect(href).toBe(`sms:4165551234&body=${encodeURIComponent(body)}`);
    expect(decodeURIComponent(href!.split('&body=')[1]!)).toBe(body);
  });

  it('uses the non-iOS ?body= separator', () => {
    const body = 'Choose a time: https://example.com/book?a=1&b=2';
    const href = buildNativeSmsUrl({
      phone: '416-555-1234',
      body,
      platform: 'other',
    });

    expect(href).toBe(`sms:4165551234?body=${encodeURIComponent(body)}`);
    expect(decodeURIComponent(href!.split('?body=')[1]!)).toBe(body);
  });

  it('rejects missing, short, and overlong recipients', () => {
    expect(buildNativeSmsUrl({ phone: null, body: 'Hello', platform: 'ios' })).toBeNull();
    expect(buildNativeSmsUrl({ phone: '555-1234', body: 'Hello', platform: 'ios' })).toBeNull();
    expect(buildNativeSmsUrl({ phone: '+44 20 7946 0958', body: 'Hello', platform: 'other' })).toBeNull();
  });
});

describe('buildClientSmsMessage', () => {
  it('builds a friendly generic text', () => {
    expect(buildClientSmsMessage('text', fullContext)).toBe(
      'Hi Ava, it’s Isla Nail Studio 😊 How can we help?',
    );
  });

  it('builds a rebooking ask with the previous service and booking link', () => {
    expect(buildClientSmsMessage('rebook', fullContext)).toBe(
      'Hi Ava 😊 would you like to book another Builder Gel Overlay appointment at Isla Nail Studio? You can choose a time here: https://islanailsalon.com/en/isla/book?source=rebook',
    );
  });

  it('builds a timezone-aware reminder with service, artist, and secure management link', () => {
    expect(buildClientSmsMessage('appointment_reminder', fullContext)).toBe([
      'Hi Ava 😊 this is a reminder about your appointment at Isla Nail Studio on Friday, July 17, 2026 at 7:00 PM.',
      'Service: Builder Gel Overlay',
      'Artist: Daniela',
      'If you need to make any changes, use this secure link: https://islanailsalon.com/manage/secure-token',
    ].join('\n'));
  });

  it('builds complete appointment details including the local range and price', () => {
    expect(buildClientSmsMessage('appointment_details', fullContext)).toBe([
      'Hi Ava 😊 here are your appointment details for Isla Nail Studio:',
      'Date: Friday, July 17, 2026',
      'Time: 7:00 PM–8:30 PM',
      'Service: Builder Gel Overlay',
      'Artist: Daniela',
      'Price: $65.00',
      'View or change your appointment: https://islanailsalon.com/manage/secure-token',
    ].join('\n'));
  });

  it('uses the configured timezone rather than the device timezone', () => {
    const vancouverContext: ClientSmsContext = {
      ...fullContext,
      salon: { ...fullContext.salon, timeZone: 'America/Vancouver' },
    };

    expect(buildClientSmsMessage('appointment_reminder', vancouverContext)).toContain(
      'on Friday, July 17, 2026 at 4:00 PM',
    );
  });

  it('builds directions with address, parking, and a generated Maps URL', () => {
    expect(buildClientSmsMessage('directions', fullContext)).toBe([
      'Hi Ava 😊 here are directions to Isla Nail Studio:',
      '123 Queen St W, Toronto, ON, M5H 2M9',
      'Parking: Use the Green P lot behind the salon.',
      'Maps: https://www.google.com/maps/dir/?api=1&destination=123%20Queen%20St%20W%2C%20Toronto%2C%20ON%2C%20M5H%202M9',
    ].join('\n'));
  });

  it('prefers an explicitly configured Maps URL', () => {
    const context: ClientSmsContext = {
      ...fullContext,
      salon: {
        ...fullContext.salon,
        location: {
          ...fullContext.salon.location,
          mapsUrl: 'https://maps.app.goo.gl/isla',
        },
      },
    };

    expect(buildClientSmsMessage('directions', context)).toContain('Maps: https://maps.app.goo.gl/isla');
  });

  it('reuses the satisfaction and Google review follow-up copy', () => {
    expect(buildClientSmsMessage('satisfaction', fullContext)).toBe(
      'Hi Ava 😊 thank you for coming to Isla Nail Studio today. Were you happy with your nails?',
    );
    expect(buildClientSmsMessage('google_review', fullContext)).toBe(
      'Hi Ava 😊 thank you for coming to Isla Nail Studio today. I would really appreciate it if you could leave us a Google review: https://g.page/r/isla/review',
    );
  });

  it('returns null for a Google review request without a configured URL', () => {
    const context: ClientSmsContext = {
      ...fullContext,
      salon: { ...fullContext.salon, googleReviewUrl: '  ' },
    };

    expect(buildClientSmsMessage('google_review', context)).toBeNull();
  });

  it('uses safe copy fallbacks without leaking undefined, null, or invalid dates', () => {
    const sparseContext: ClientSmsContext = {
      client: { phone: '4165551234', name: ' ' },
      salon: { timeZone: 'Not/A_Time_Zone' },
      appointment: {
        startTime: 'not-a-date',
        serviceNames: [null, ' ', undefined],
        totalPriceCents: Number.NaN,
      },
    };

    const messages = [
      buildClientSmsMessage('text', sparseContext),
      buildClientSmsMessage('rebook', sparseContext),
      buildClientSmsMessage('appointment_reminder', sparseContext),
      buildClientSmsMessage('appointment_details', sparseContext),
      buildClientSmsMessage('directions', sparseContext),
      buildClientSmsMessage('satisfaction', sparseContext),
    ];

    for (const message of messages) {
      expect(message).toBeTruthy();
      expect(message).not.toMatch(/undefined|null|Invalid Date/);
    }

    expect(messages[1]).toContain('Reply to this message and we’ll help you find a time.');
    expect(messages[2]).toContain('If you need to make any changes, reply to this message.');
    expect(messages[4]).toContain('Reply to this message for directions and parking information.');
  });

  it('deduplicates and removes empty service names', () => {
    const context: ClientSmsContext = {
      ...fullContext,
      appointment: {
        ...fullContext.appointment,
        serviceNames: ['Builder Gel', null, '  ', 'Nail Art', 'Builder Gel'],
      },
    };

    expect(buildClientSmsMessage('appointment_details', context)).toContain(
      'Service: Builder Gel, Nail Art',
    );
  });
});

describe('composeClientSmsDraft', () => {
  it('returns normalized recipient, editable body, and the encoded href together', () => {
    const draft = composeClientSmsDraft({
      kind: 'appointment_reminder',
      context: fullContext,
      platform: 'ios',
    });

    expect(draft?.recipient).toBe('4165551234');
    expect(draft?.href).toBe(`sms:4165551234&body=${encodeURIComponent(draft!.body)}`);
    expect(draft?.body).toContain('use this secure link');
  });

  it('returns null when the phone is invalid or required review data is unavailable', () => {
    const invalidPhoneContext: ClientSmsContext = {
      ...fullContext,
      client: { ...fullContext.client, phone: '555-1234' },
    };
    const missingReviewContext: ClientSmsContext = {
      ...fullContext,
      salon: { ...fullContext.salon, googleReviewUrl: null },
    };

    expect(composeClientSmsDraft({ kind: 'text', context: invalidPhoneContext, platform: 'ios' })).toBeNull();
    expect(composeClientSmsDraft({ kind: 'google_review', context: missingReviewContext, platform: 'ios' })).toBeNull();
  });
});
