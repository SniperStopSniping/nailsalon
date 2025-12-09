/**
 * Super Admin utilities for platform owner controls
 *
 * Super admin is identified via environment variable SUPER_ADMIN_EMAILS
 * which contains a comma-separated list of email addresses.
 */

/**
 * Check if a user email is a super admin
 * @param email - The email to check (from Clerk user)
 * @returns true if the email is in the SUPER_ADMIN_EMAILS list
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }

  const superAdminEmails
    = process.env.SUPER_ADMIN_EMAILS?.split(',').map(e =>
      e.trim().toLowerCase(),
    ) || [];

  return superAdminEmails.includes(email.toLowerCase());
}

/**
 * Get the list of super admin emails (for debugging/logging)
 * @returns Array of super admin email addresses
 */
export function getSuperAdminEmails(): string[] {
  return (
    process.env.SUPER_ADMIN_EMAILS?.split(',').map(e =>
      e.trim().toLowerCase(),
    ) || []
  );
}
