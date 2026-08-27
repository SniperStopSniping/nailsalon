const SINGLE_LINE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MULTILINE_UNSAFE_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export const parseBoundedSingleLineText = (
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): string | null => {
  if (
    typeof value !== 'string' ||
    SINGLE_LINE_CONTROL_CHARACTER_PATTERN.test(value)
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
    typeof value !== 'string' ||
    MULTILINE_UNSAFE_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
};
