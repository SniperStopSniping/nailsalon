import { redirect } from 'next/navigation';

// Redirect Clerk sign-up to phone OTP admin login
export default async function SignUpPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/admin-login`);
}
