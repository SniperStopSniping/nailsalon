import { redirect } from 'next/navigation';

// Redirect Clerk sign-in to phone OTP admin login
export default async function SignInPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/admin-login`);
}
