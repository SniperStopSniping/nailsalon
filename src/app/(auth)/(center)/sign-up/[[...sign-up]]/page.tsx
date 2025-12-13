import { redirect } from 'next/navigation';

// Redirect Clerk sign-up to phone OTP admin login
export default function SignUpPage() {
  redirect('/en/admin-login');
}
