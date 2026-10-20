import { expect, it, vi } from 'vitest';

import { assertPreservedWebsiteWording, websiteWordingForModel } from './wording.server';

vi.mock('server-only', () => ({}));

const saved = '<h1 data-edit="hero-title">Nails, beautifully considered.</h1><p data-edit="intro">Your own quiet moment.</p>';

it('reads saved editable words and headings while omitting dynamic fields, hidden text, comments and templates', () => {
  const html = `${saved}<h2 data-luster-field="business.name">Bound business</h2><div data-edit="bound"><span data-luster-field="service.name">Bound service</span></div><h1 hidden>Hidden title</h1><template><h1>Template title</h1></template><!-- <h1>Comment title</h1> -->`;

  expect(websiteWordingForModel(html)).toEqual([
    { key: 'hero-title', kind: 'headline', text: 'Nails, beautifully considered.' },
    { key: 'intro', kind: 'text', text: 'Your own quiet moment.' },
  ]);
});

it.each([
  'Make the illustration bigger. Keep my edited headline, service prices and everything else.',
  'Preserve the headline and make the background cream.',
  'Change the background but keep my current headline.',
])('rejects a stale headline during an explicitly bounded visual edit: %s', (message) => {
  expect(() => assertPreservedWebsiteWording(saved.replace('Nails, beautifully considered.', 'Nails, quietly confident.'), saved, message)).toThrow('Nails, beautifully considered.');
});

it('allows new composition, edit identifiers and nested typography with the same saved headline', () => {
  const redesigned = '<section class="original-composition"><h1 data-edit="new-title">Nails,<br><em>beautifully considered.</em></h1><p data-edit="new-intro">New supporting copy.</p></section>';

  expect(() => assertPreservedWebsiteWording(redesigned, saved, 'Make the hero larger. Keep my edited headline.')).not.toThrow();
});

it('does not accept preserved words hidden elsewhere as the real headline', () => {
  const changed = '<h1>Old headline.</h1><h1 hidden>Nails, beautifully considered.</h1><p data-edit="other">Nails, beautifully considered.</p>';

  expect(() => assertPreservedWebsiteWording(changed, saved, 'Keep my headline and make the hero larger.')).toThrow();
});

it('checks all saved editable words when the owner explicitly preserves wording', () => {
  expect(() => assertPreservedWebsiteWording(saved.replace('Your own quiet moment.', 'Unrequested rewrite.'), saved, 'Make it beige and keep all my wording.')).toThrow('Your own quiet moment.');
});

it.each(['Keep the design, but change my headline to Hello.', 'Rewrite the headline in French.', 'Completely redesign the website.'])('allows deliberate copy changes and a new design brief: %s', (message) => {
  expect(() => assertPreservedWebsiteWording('<h1 data-edit="new-title">A new beginning.</h1>', saved, message)).not.toThrow();
});

it('decodes entities when comparing the visible saved wording', () => {
  expect(() => assertPreservedWebsiteWording('<h1>Nails &amp; beauty.</h1>', '<h1 data-edit="title">Nails &#38; beauty.</h1>', 'Keep the headline.')).not.toThrow();
});
