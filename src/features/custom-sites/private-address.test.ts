import { expect, it } from 'vitest';

import { containsPrivateAddress } from './private-address';

it.each(['123 Private Street', '123, PRIVATE street', '123%20Private%20Street', '123%2520Private%2520Street', 'query=123%20Private%20Street&other=bad%value'])('recognizes the exact private address in %s', (text) => {
  expect(containsPrivateAddress(text, '123 Private Street')).toBe(true);
});

it('keeps general public directions and empty addresses separate', () => {
  expect(containsPrivateAddress('Dixie Road and Countryside Drive', '123 Private Street')).toBe(false);
  expect(containsPrivateAddress('Toronto', '')).toBe(false);
});
