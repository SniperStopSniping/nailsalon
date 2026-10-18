import { expect, it } from 'vitest';

import { requestsFirstWebsite, requestsPreviewNow, requestsSampleDetails } from './design-intent';

it.each(['Make my booking website from this design. I work solo.', 'Please create my website.', 'I work solo. Could you build my website from this?', 'Generate a booking page using my image'])('recognizes an explicit draft request: %s', message => expect(requestsFirstWebsite(message)).toBe(true));

it.each(['Do not create my website yet.', 'What would the website look like?', 'Make BIAB $65.', 'Change my Instagram.', 'I will create my website later.', 'Publish my website.', 'Make my website later.', 'Make my website, but do not generate it yet.'])('does not invent generation permission: %s', message => expect(requestsFirstWebsite(message)).toBe(false));

it.each(['Just make it up', 'Use sample details for now', 'Pick random prices', 'Make something up'])('creates a first preview with requested suggestions: %s', (message) => {
  expect(requestsPreviewNow(message)).toBe(true);
  expect(requestsSampleDetails(message)).toBe(true);
});

it.each(['Make exactly like this', 'Recreate my design', 'Match this image'])('recognizes an attached reference request: %s', message => expect(requestsPreviewNow(message, true)).toBe(true));

it.each(['Keep this design exactly as it is and make the booking buttons clickable.', 'Please preserve my Canva artwork and add links.'])('recognizes a request to make original artwork interactive: %s', (message) => {
  expect(requestsPreviewNow(message, true)).toBe(true);
  expect(requestsPreviewNow(message, false)).toBe(false);
});

it.each(['Create my website for Pink Lily Studio in Toronto. Use suggested services and hours for now.', 'I work solo. Just make it up.', 'Use sample prices but BIAB is 60 minutes.', 'Make it up, my name is Kayla.'])('does not skip supplied business answers with a suggestion shortcut: %s', message => expect(requestsSampleDetails(message)).toBe(false));

it.each(['Do not make it up', 'Use sample details later', 'What does this image look like?', 'Read the details in my image', 'Make BIAB $65', 'Publish my website', 'Would keeping my design make it clickable?', 'Keep my artwork, but do not create the website yet.'])('does not invent sample or design permission: %s', message => expect(requestsPreviewNow(message, true)).toBe(false));
