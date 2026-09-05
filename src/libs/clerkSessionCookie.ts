/**
 * Detects whether an existing Clerk session needs request context. Clerk uses
 * both a bare cookie and instance-suffixed cookies. This is only a presence
 * check: the SDK must still validate the token and resolve its active instance.
 */
export function hasClerkSessionCookie(
  cookies: readonly { name: string; value: string }[],
): boolean {
  return cookies.some(({ name, value }) => Boolean(value.trim()) && (
    name === '__session' || /^__session_[\w-]+$/u.test(name)
  ));
}
