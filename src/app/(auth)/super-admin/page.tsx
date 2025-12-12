import { redirect } from 'next/navigation';

// Redirect to locale-aware super-admin page
export default function SuperAdminRedirectPage() {
  redirect('/en/super-admin');
}
