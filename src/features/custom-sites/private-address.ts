const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Compare owner-private addresses in ordinary text and encoded link targets. */
export function containsPrivateAddress(value: string, address: string) {
  const expected = normalize(address);
  if (!expected) {
    return false;
  }
  let decoded = value;
  for (let pass = 0; pass < 5; pass++) {
    if (normalize(decoded).includes(expected)) {
      return true;
    }
    const next = decoded.replace(/(?:%[\da-f]{2})+/giu, (part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    if (next === decoded) {
      break;
    }
    decoded = next;
  }
  return false;
}
