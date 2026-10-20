import { expect, it } from 'vitest';

import { rejectsSupportedAboutText, usesSavedCanvaPhotoContext } from './canva-photo-context';

it.each([
  'Add my two new test photos in a Gallery below the artwork, with the wide photo first and the portrait second. Keep the Canva artwork, links, services and settings unchanged.',
  'Put the portrait photo first and make it the larger first image in the Gallery. Leave the artwork, links, services and settings alone.',
  'Make the first Gallery photo larger.',
  'Remove the second photo.',
  'Use Large first photo.',
  'Describe my Gallery photo as green nail art.',
  'Move the Gallery photo later and set BIAB to $65.',
  'Add an About section with my portrait. Say A calm space for thoughtful nails.',
  'Change my About text to Welcome to the studio.',
])('can reuse saved artwork context for a photo instruction: %s', message => expect(usesSavedCanvaPhotoContext(message)).toBe(true));

it.each([
  'Read my design and add the photos below it.',
  'Re-read all the details from this image.',
  'Extract the hours from my image and move the Gallery below it.',
  'Use the prices from the menu image and add my Gallery.',
  'Add the phone number from the photo.',
  'Move the hours from this image into my website.',
  'What does the policy in this image say?',
  'Copy the details in my photo.',
  'Check my Instagram in the image and add my Gallery.',
  'Make an entirely new website from my reference.',
  'Publish the website.',
  'Make the background beige.',
  'Read my About text from the image.',
  'Add an About section using the text on this design.',
])('retains vision eligibility for extraction or unrelated requests: %s', message => expect(usesSavedCanvaPhotoContext(message)).toBe(false));

it('recognizes a false fixed-artwork denial for editable About wording, without treating style or reference requests as supported text edits', () => {
  const reply = 'I can’t change the About heading in the current fixed-artwork design. Upload an updated Canva export.';

  expect(rejectsSupportedAboutText('Change the About heading to Meet the studio. Keep the artwork and photos the same.', reply, 1)).toBe(true);
  expect(rejectsSupportedAboutText('Change the About wording to Welcome.', reply, 1)).toBe(true);
  expect(rejectsSupportedAboutText('Change the About heading font.', reply, 1)).toBe(false);
  expect(rejectsSupportedAboutText('Change the printed About heading.', reply, 1)).toBe(false);
  expect(rejectsSupportedAboutText('Change the About heading to Meet me.', 'Which About section do you mean?', 1)).toBe(false);
  expect(rejectsSupportedAboutText('Change the About heading to Meet me.', reply, 0)).toBe(false);
  expect(rejectsSupportedAboutText('Change the About heading to Meet me.', reply, 2)).toBe(false);
});
