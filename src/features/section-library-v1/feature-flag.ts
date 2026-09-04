/** Pure, dark-by-default resolver shared by server route guards. */
export const resolveSectionLibraryV1Enabled = (
  configuredValue: string | undefined,
): boolean => configuredValue === 'true';
