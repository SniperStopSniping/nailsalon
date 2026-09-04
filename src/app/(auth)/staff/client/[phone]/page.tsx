import { redirect } from 'next/navigation';

export default async function StaffClientProfilePage(props: { params: Promise<{ phone: string }> }) {
  const params = await props.params;
  redirect(`/en/staff/client/${params.phone}`);
}
