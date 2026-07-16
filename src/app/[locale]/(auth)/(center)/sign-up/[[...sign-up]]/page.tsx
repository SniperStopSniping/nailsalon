import { redirect } from 'next/navigation';

// Keep the legacy route working while directing owners to Clerk email/password.
export default async function SignUpPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/owner-sign-in`);
}
