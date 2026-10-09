// Kept independent of database-backed adminAuth so middleware can identify
// the legacy session path without importing server authentication machinery.
export const ADMIN_SESSION_COOKIE = 'n5_admin_session';
