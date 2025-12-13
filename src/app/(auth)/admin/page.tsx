import { redirect } from 'next/navigation';

/**
 * Non-locale admin page - redirects to locale version
 */
export default function AdminPage() {
  redirect('/en/admin');
}
