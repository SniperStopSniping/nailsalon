import { describe, expect, it, vi } from 'vitest';

import { bindWebsiteContacts, recoverSavedContacts, requestsContactRepair } from './contacts.server';
import { assertWebsiteDetailsCoverage } from './website-coverage.server';
import { EMPTY_WEBSITE_DETAILS } from './website-details';

vi.mock('server-only', () => ({}));
const source = { title: 'Test', html: '<a class="pink" data-luster-link="instagram">Instagram: <strong>@DynastyBeauty</strong></a><p>Email: hello@example.com</p><p>Phone: (416) 555-0100</p>', css: '.pink{color:pink}', javascript: '', analysis: '', limitations: [] };

describe('deterministic contact wiring', () => {
  it('recovers legacy visible contacts, preserves styling, and binds destinations and text', () => {
    const details = recoverSavedContacts(source.html);

    expect(details).toMatchObject({ instagram: '@DynastyBeauty', email: 'hello@example.com', phone: '(416) 555-0100' });

    const wired = bindWebsiteContacts(source, details);

    expect(wired.css).toBe(source.css);
    expect(wired.html).toContain('class="pink"');
    expect(wired.html).toContain('data-luster-field="details.instagram"');
    expect(wired.html).toContain('data-luster-link="email"');
    expect(wired.html).toContain('data-luster-link="phone"');
    expect(() => assertWebsiteDetailsCoverage(wired.html, details)).not.toThrow();
    expect(bindWebsiteContacts(wired, details)).toEqual(wired);
  });

  it('rejects dangling links even with no website details saved', () => {
    expect(() => assertWebsiteDetailsCoverage(source.html)).toThrow('Save the Instagram handle');
    expect(() => assertWebsiteDetailsCoverage('<p>@missing</p>', EMPTY_WEBSITE_DETAILS)).toThrow('Save the Instagram handle');
  });

  it('does not recover hidden, metadata-only, ambiguous or executable content', () => {
    expect(recoverSavedContacts('<a data-luster-link="instagram" aria-label="@metadata">Follow</a><p hidden>@hidden</p><script>@unsafe</script>').instagram).toBeNull();
    expect(() => recoverSavedContacts('<p>@first @second</p>')).toThrow('more than one');
    expect(recoverSavedContacts(source.html, { ...EMPTY_WEBSITE_DETAILS, instagram: '@saved' }).instagram).toBe('@saved');
  });

  it('does not mistake an email for Instagram, or a partial handle for the saved handle', () => {
    expect(recoverSavedContacts('<p>hello@example.com</p>').instagram).toBeNull();

    const mismatched = bindWebsiteContacts({ ...source, html: '<p>@salonextra</p>' }, { ...EMPTY_WEBSITE_DETAILS, instagram: '@salon' });

    expect(mismatched.html).not.toContain('data-luster-link');
    expect(() => assertWebsiteDetailsCoverage(mismatched.html, { ...EMPTY_WEBSITE_DETAILS, instagram: '@salon' })).toThrow('saved instagram');
  });

  it('wires generic anchors and standalone data fields without a model repair', () => {
    const details = { ...EMPTY_WEBSITE_DETAILS, instagram: '@studio', email: 'hello@example.com' };
    const wired = bindWebsiteContacts({ ...source, html: '<a class="contact" href="#">@studio</a><span data-luster-field="details.email"></span>' }, details);

    expect(() => assertWebsiteDetailsCoverage(wired.html, details)).not.toThrow();
    expect(wired.html).toContain('class="contact" data-luster-link="instagram"');
  });

  it('only short, unambiguous contact instructions use the no-model action', () => {
    expect(requestsContactRepair('Make the Instagram clickable')).toBe(true);
    expect(requestsContactRepair('Fix my phone number')).toBe(true);
    expect(requestsContactRepair('Make Instagram clickable and change BIAB to $65')).toBe(false);
    expect(requestsContactRepair('Redesign the Instagram section')).toBe(false);
  });
});
