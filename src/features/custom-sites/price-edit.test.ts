import { expect, it } from 'vitest';

import { isExplicitServicePriceEdit } from './price-edit';

it.each(['Set a $25 deposit', 'Change the tax to CAD5', 'Make the late fee $15', 'Set the no-show fee to $20'])('keeps operational payment requests out of the catalogue-only price scope: %s', (message) => {
  expect(isExplicitServicePriceEdit(message)).toBe(false);
});

it.each(['Change BIAB to $65', 'Keep the design, but set nail art to CAD12', 'Update gel manicures to 70 dollars'])('keeps explicit service and add-on prices supported: %s', (message) => {
  expect(isExplicitServicePriceEdit(message)).toBe(true);
});
