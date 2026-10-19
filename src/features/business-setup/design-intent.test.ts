import { expect, it } from 'vitest';

import { requestsFirstWebsite, requestsPreviewNow, requestsSampleDetails, requestsVisualEdit } from './design-intent';

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

it.each(['Keep the burgundy and ivory design. Make the two photos larger and overlap them in the studio section. Keep my logo, services and the rest of the design.', 'Completely redesign the hero.', 'Make the mobile version less crowded.', 'Put services above the gallery.', 'Put the logo in the middle.', 'Use a more elegant font.', 'Make the background beige.', 'Can you make the hero image bigger?', 'Add animated transitions.'])('routes an explicit existing-site visual edit: %s', message => expect(requestsVisualEdit(message)).toBe(true));

it.each(['Keep the design, but change BIAB to $65.', 'Make photos larger and change BIAB to 65.', 'Make the logo bigger and use 4165550199.', 'Make the hero bigger and close Sundays.', 'Make photos bigger and add staff.', 'Make the images larger later.', 'Make the logo bigger, but don’t change it yet.', 'What would larger images look like?', 'Would a larger logo be better?', 'Publish my website.', 'Keep my Canva image exactly as it is.'])('leaves business changes, questions, cancellations and publication out of the visual shortcut: %s', message => expect(requestsVisualEdit(message)).toBe(false));
