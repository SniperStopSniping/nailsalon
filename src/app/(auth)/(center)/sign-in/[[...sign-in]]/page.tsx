import { redirect } from 'next/navigation';

// Redirect Clerk sign-in to phone OTP admin login
export default function SignInPage() {
  redirect('/en/admin-login');
}
