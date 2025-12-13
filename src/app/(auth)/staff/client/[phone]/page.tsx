import { redirect } from 'next/navigation';

export default function StaffClientProfilePage({ params }: { params: { phone: string } }) {
  redirect(`/en/staff/client/${params.phone}`);
}
