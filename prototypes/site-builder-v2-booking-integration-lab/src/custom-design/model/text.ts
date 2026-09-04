/** ASCII controls are rejected; multiline plain text may retain tabs and line breaks. */
export const hasUnsafeTextControls = (value: string, multiline = false): boolean =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 31 || code === 127)
      && !(multiline && (code === 9 || code === 10 || code === 13));
  });

export const parseBoundedSingleLineText = (
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): string | null => {
  if (
    typeof value !== 'string'
    || hasUnsafeTextControls(value)
  ) {
    return null;
  }
  const trimmed = value.trim();
  if ((!allowEmpty && trimmed.length === 0) || trimmed.length > maximumLength) {
    return null;
  }
  return trimmed;
};

export const parseBoundedMultilinePlainText = (
  value: unknown,
  maximumLength: number,
): string | null => {
  if (
    typeof value !== 'string'
    || hasUnsafeTextControls(value, true)
  ) {
    return null;
  }
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
};
