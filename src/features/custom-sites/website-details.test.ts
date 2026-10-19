import { describe, expect, it, vi } from 'vitest';

import { assertWebsiteDetailsCoverage } from './website-coverage.server';
import { EMPTY_WEBSITE_DETAILS, websiteContactLinks, websiteDetailsSchema } from './website-details';

vi.mock('server-only', () => ({}));
const details = { ...EMPTY_WEBSITE_DETAILS, locationDirections: 'Dixie and Countryside', instagram: '@dynastybeautyy', email: 'studio@example.com', sections: [{ id: 'guests', title: 'Guests', text: 'Please come alone.' }] };
const complete = '<p data-luster-field="details.locationDirections"></p><a data-luster-link="instagram"><span data-luster-field="details.instagram"></span></a><a data-luster-link="email"><span data-luster-field="details.email"></span></a><h2 data-luster-field="details.title_guests"></h2><p data-luster-field="details.section_guests"></p>';

describe('complete public website details', () => {
  it('validates contacts and creates only supported destinations', () => {
    expect(websiteContactLinks(details)).toEqual({ instagram: 'https://www.instagram.com/dynastybeautyy/', email: 'mailto:studio@example.com' });

    for (const instagram of ['https://evil.invalid', 'name?redirect=evil', 'javascript:alert(1)']) {
      expect(websiteDetailsSchema.safeParse({ ...details, instagram }).success).toBe(false);
    }

    expect(websiteDetailsSchema.safeParse({ ...details, sections: [details.sections[0], details.sections[0]] }).success).toBe(false);
  });

  it('requires full text and working contact bindings before accepting generation', () => {
    expect(() => assertWebsiteDetailsCoverage(complete, details)).not.toThrow();
    expect(() => assertWebsiteDetailsCoverage(complete.replace('data-luster-link="instagram"', ''), details)).toThrow('clickable');
    expect(() => assertWebsiteDetailsCoverage(complete.replace('details.section_guests', 'business.bio'), details)).toThrow('Guests');
    expect(() => assertWebsiteDetailsCoverage(`<template>${complete}</template>`, details)).toThrow('missing');
    expect(() => assertWebsiteDetailsCoverage(`<div hidden>${complete}</div>`, details)).toThrow('missing');
  });

  it('rejects obsolete section bindings instead of leaving an empty or stale policy card', () => {
    expect(() => assertWebsiteDetailsCoverage('<p data-luster-field="details.section_old_policy"></p>', EMPTY_WEBSITE_DETAILS)).toThrow('obsolete website section');
    expect(() => assertWebsiteDetailsCoverage('<h2 data-luster-field="details.title_removed"></h2>')).toThrow('obsolete website section');
    expect(() => assertWebsiteDetailsCoverage(complete, details)).not.toThrow();
  });
});
