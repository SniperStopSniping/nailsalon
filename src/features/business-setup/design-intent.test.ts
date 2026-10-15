import { expect, it } from 'vitest';

import { requestsFirstWebsite } from './design-intent';

it.each(['Make my booking website from this design. I work solo.', 'Please create my website.', 'I work solo. Could you build my website from this?', 'Generate a booking page using my image'])('recognizes an explicit draft request: %s', message => expect(requestsFirstWebsite(message)).toBe(true));

it.each(['Do not create my website yet.', 'What would the website look like?', 'Make BIAB $65.', 'Change my Instagram.', 'I will create my website later.', 'Publish my website.', 'Make my website later.', 'Make my website, but do not generate it yet.'])('does not invent generation permission: %s', message => expect(requestsFirstWebsite(message)).toBe(false));
