import { redirect } from 'next/navigation';

export default async function LegacyAdminLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/owner-sign-in`);
}
